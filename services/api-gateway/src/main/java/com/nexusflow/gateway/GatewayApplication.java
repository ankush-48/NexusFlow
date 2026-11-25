package com.nexusflow.gateway;

import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.*;
import io.netty.util.NetUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.gateway.route.*;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.*;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsWebFilter;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;
import org.springframework.web.server.*;
import reactor.core.publisher.Mono;

@SpringBootApplication
public class GatewayApplication {
    private static final Set<String> AUTH = Set.of("/api/auth/login","/api/auth/register","/api/auth/forgot-password",
        "/api/auth/resend-verification","/api/auth/reset-password","/api/auth/verify","/api/auth/refresh","/api/auth/logout","/api/billing/stripe/webhook");
    static final String CLIENT_IP = "X-NexusFlow-Client-IP";
    private static final RedisScript<Long> COUNTER = RedisScript.of("""
        local n=redis.call('INCR', KEYS[1])
        if n==1 then redis.call('EXPIRE', KEYS[1], 60) end
        return n
        """,Long.class);

    public static void main(String[] args) {SpringApplication.run(GatewayApplication.class,args);}

    @Bean
    RouteLocator routes(RouteLocatorBuilder builder,@Value("${nexus.core}") String core,@Value("${nexus.realtime}") String realtime) {
        return builder.routes()
            .route("socket-upgrade",r->r.path("/socket.io","/socket.io/**").and().header("Upgrade","(?i)websocket")
                .uri(realtime.startsWith("https:")?"wss:"+realtime.substring(6):"ws:"+realtime.substring(5)))
            .route("socket-polling",r->r.path("/socket.io","/socket.io/**").uri(realtime))
            .route("realtime",r->r.path("/api/collab/**").uri(realtime))
            .route("core",r->r.path("/api/**","/swagger-ui.html","/swagger-ui/**","/v3/api-docs/**").uri(core))
            .build();
    }

    @Bean
    @Order(-100)
    CorsWebFilter cors(@Value("${nexus.origin}") String origin) {
        var config=new CorsConfiguration();
        config.setAllowedOrigins(List.of(origin));
        config.setAllowedMethods(List.of("GET","HEAD","POST","PATCH","DELETE","OPTIONS"));
        config.setAllowedHeaders(List.of("Content-Type","Accept","X-Correlation-ID"));
        config.setExposedHeaders(List.of("X-Correlation-ID"));
        config.setAllowCredentials(true);
        var source=new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**",config);
        return new CorsWebFilter(source);
    }

    @Bean
    @Order(-90)
    WebFilter requestPolicies(ReactiveStringRedisTemplate redis,@Value("${nexus.rate-limit}") boolean limit,
                             @Value("${nexus.trust-ingress-ip}") boolean trustIngress) {
        return (exchange,chain)->{
            var request=exchange.getRequest();
            String path=request.getPath().value();
            String correlation=UUID.randomUUID().toString();
            exchange.getResponse().getHeaders().set("X-Correlation-ID",correlation);
            if (!path.startsWith("/api/")) return chain.filter(exchange);
            exchange.getResponse().getHeaders().setCacheControl("no-store");
            boolean auth=AUTH.contains(path);
            if (!auth && request.getCookies().getFirst("nf_access")==null)
                return problem(exchange,401,"Sign in to continue.");
            var traced=exchange.mutate().request(request.mutate().headers(headers->{
                headers.remove(CLIENT_IP);
                headers.set("X-Correlation-ID",correlation);
            }).build()).build();
            if (!limit) return chain.filter(traced);
            String source=clientAddress(request.getRemoteAddress(),request.getHeaders().getOrEmpty(CLIENT_IP),trustIngress);
            boolean credentialAttempt=auth && !Set.of("/api/auth/refresh","/api/auth/logout","/api/billing/stripe/webhook").contains(path);
            String bucket=credentialAttempt?"authentication":"api";
            return redis.execute(COUNTER,List.of("nexusflow:rate:"+bucket+":"+source),List.of()).next().defaultIfEmpty(0L)
                .timeout(Duration.ofSeconds(2)).onErrorReturn(-1L)
                .flatMap(count->count<0 ? problem(exchange,503,"Request throttling is temporarily unavailable.")
                    : count>(credentialAttempt?30:600)?problem(exchange,429,"Too many requests. Try again shortly."):chain.filter(traced));
        };
    }

    static String clientAddress(InetSocketAddress remote,List<String> ingressAddresses,boolean trustIngress) {
        if (trustIngress && ingressAddresses.size()==1) {
            String address=ingressAddresses.getFirst();
            if (address.length()<=45 && !address.contains("%") && !address.startsWith("[")) {
                byte[] bytes=NetUtil.createByteArrayFromIpAddressString(address);
                if (bytes!=null) return NetUtil.bytesToIpAddress(bytes);
            }
        }
        return remote==null || remote.getAddress()==null?"unknown":remote.getAddress().getHostAddress();
    }

    private static Mono<Void> problem(ServerWebExchange exchange,int code,String detail) {
        var response=exchange.getResponse();
        response.setStatusCode(HttpStatus.valueOf(code));
        response.getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
        if (code==429) response.getHeaders().set("Retry-After","60");
        var body=("{\"status\":"+code+",\"detail\":\""+detail+"\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return response.writeWith(Mono.just(response.bufferFactory().wrap(body)));
    }
}

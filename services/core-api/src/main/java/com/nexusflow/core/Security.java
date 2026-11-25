package com.nexusflow.core;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
class Security {
    @Bean
    BCryptPasswordEncoder encoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    SecurityFilterChain securityChain(HttpSecurity http, Sessions sessions, @Value("${nexus.origin}") String origin) throws Exception {
        var filter = new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                    throws IOException, ServletException {
                String requestOrigin = request.getHeader("Origin");
                String fetchSite = request.getHeader("Sec-Fetch-Site");
                if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())
                        && ((requestOrigin != null && !origin.equals(requestOrigin)) || "cross-site".equals(fetchSite))) {
                    problem(response, 403, "Request origin is not allowed.");
                    return;
                }
                sessions.resolve(cookie(request,"nf_access")).ifPresent(user -> SecurityContextHolder.getContext()
                    .setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user, null, java.util.List.of())));
                chain.doFilter(request,response);
            }
        };
        return http.csrf(AbstractHttpConfigurer::disable).formLogin(AbstractHttpConfigurer::disable)
            .httpBasic(AbstractHttpConfigurer::disable).logout(AbstractHttpConfigurer::disable)
            .sessionManagement(config -> config.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(config -> config.authenticationEntryPoint((request,response,error) -> problem(response,401,"Sign in to continue.")))
            .authorizeHttpRequests(config -> config
                .requestMatchers("/actuator/health/**","/actuator/prometheus","/v3/api-docs/**","/swagger-ui/**","/swagger-ui.html",
                    "/api/auth/register","/api/auth/login","/api/auth/refresh","/api/auth/logout","/api/auth/forgot-password",
                    "/api/auth/reset-password","/api/auth/verify","/api/auth/resend-verification","/api/billing/stripe/webhook","/internal/events","/internal/workflow-email").permitAll()
                .anyRequest().authenticated())
            .addFilterBefore(filter,AnonymousAuthenticationFilter.class).build();
    }

    static String cookie(HttpServletRequest request, String name) {
        if (request.getCookies() != null) for (Cookie cookie : request.getCookies()) {
            if (name.equals(cookie.getName())) return cookie.getValue();
        }
        return "";
    }

    static void problem(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.getWriter().write("{\"status\":" + status + ",\"detail\":\"" + message + "\"}");
    }
}

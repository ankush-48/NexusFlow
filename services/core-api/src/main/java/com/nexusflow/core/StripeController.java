package com.nexusflow.core;

import tools.jackson.databind.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import static com.nexusflow.core.AuthController.status;

@RestController
class StripeController {
    record Plan(@NotNull @Pattern(regexp="Free|Professional|Enterprise") String plan) {}
    private final JdbcTemplate db;
    private final Tenants tenants;
    private final Events events;
    private final ObjectMapper json;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final String billing, key, webhook, origin, professional, enterprise;

    StripeController(JdbcTemplate db,Tenants tenants,Events events,ObjectMapper json,
        @Value("${nexus.billing}") String billing,@Value("${STRIPE_SECRET_KEY:}") String key,
        @Value("${STRIPE_WEBHOOK_SECRET:}") String webhook,@Value("${nexus.origin}") String origin,
        @Value("${STRIPE_PRO_PRICE:}") String professional,@Value("${STRIPE_ENTERPRISE_PRICE:}") String enterprise) {
        this.db=db;this.tenants=tenants;this.events=events;this.json=json;this.billing=billing;this.key=key;this.webhook=webhook;
        this.origin=origin;this.professional=professional;this.enterprise=enterprise;
    }

    @GetMapping("/api/orgs/{org}/billing-provider")
    Map<String,String> provider(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user) {
        tenants.require(org,user,Tenants.ADMIN);
        return Map.of("provider",billing);
    }

    @PostMapping("/api/orgs/{org}/stripe-checkout")
    @Transactional
    Map<String,String> checkout(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Plan form) {
        tenants.require(org,user,Set.of("Owner"));
        if (!enabled()) throw status(HttpStatus.SERVICE_UNAVAILABLE,"Stripe test billing is unavailable.");
        db.queryForObject("SELECT id FROM organizations WHERE id=? FOR UPDATE",UUID.class,org);
        db.update("INSERT INTO stripe_subscriptions(org_id) VALUES (?) ON CONFLICT DO NOTHING",org);
        var subscription=db.queryForMap("""
            SELECT customer_id,subscription_id,checkout_url,checkout_expires>now() AS pending FROM stripe_subscriptions WHERE org_id=?
            """,org);
        Object customer=subscription.get("customer_id");
        if ((subscription.get("subscription_id")!=null || "Free".equals(form.plan())) && customer!=null) {
            return Map.of("url",url(stripe("billing_portal/sessions",Map.of("customer",customer.toString(),"return_url",origin+"/billing"),null),"billing.stripe.com"));
        }
        if ("Free".equals(form.plan())) throw status(HttpStatus.BAD_REQUEST,"This workspace has no Stripe subscription.");
        if (Boolean.TRUE.equals(subscription.get("pending")) && subscription.get("checkout_url") instanceof String pending) return Map.of("url",pending);
        String price="Professional".equals(form.plan())?professional:enterprise;
        if (!price.matches("price_[a-zA-Z0-9]+")) throw status(HttpStatus.BAD_REQUEST,"This plan is not configured in Stripe test mode.");
        long expires=Instant.now().plusSeconds(3600).getEpochSecond();
        Map<String,String> fields=new HashMap<>(Map.of(
            "mode","subscription","line_items[0][price]",price,"line_items[0][quantity]","1",
            "success_url",origin+"/billing","cancel_url",origin+"/billing","expires_at",String.valueOf(expires),
            "subscription_data[metadata][nexusflow_org]",org.toString()));
        if (customer==null) fields.put("customer_email",user.email()); else fields.put("customer",String.valueOf(customer));
        var session=stripe("checkout/sessions",fields,"nexusflow-"+org+"-"+(expires/60));
        String url=url(session,"checkout.stripe.com");
        db.update("UPDATE stripe_subscriptions SET checkout_url=?,checkout_expires=to_timestamp(?) WHERE org_id=?",url,expires,org);
        return Map.of("url",url);
    }

    @PostMapping("/api/billing/stripe/webhook")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    void receive(@RequestHeader(value="Stripe-Signature",required=false) String signature,@RequestBody byte[] body) throws java.io.IOException {
        if (!enabled()) throw status(HttpStatus.SERVICE_UNAVAILABLE,"Stripe test billing is unavailable.");
        if (body.length>1024*1024 || !StripeSignatures.verify(body,signature,webhook,Instant.now()))
            throw status(HttpStatus.BAD_REQUEST,"Invalid Stripe webhook signature.");
        JsonNode event=json.readTree(body);
        if (event.path("livemode").asBoolean(true)) throw status(HttpStatus.BAD_REQUEST,"Only Stripe test events are allowed.");
        String type=event.path("type").asText();
        if (!Set.of("customer.subscription.created","customer.subscription.updated","customer.subscription.deleted").contains(type)) return;
        var subscription=event.path("data").path("object");
        UUID org;
        try {org=UUID.fromString(subscription.path("metadata").path("nexusflow_org").asText());}
        catch (IllegalArgumentException error) {return;}
        var orgRow=db.queryForList("SELECT id,plan FROM organizations WHERE id=? FOR UPDATE",org);
        if (orgRow.isEmpty()) return;
        var row=db.queryForList("SELECT customer_id,subscription_id,last_event_at FROM stripe_subscriptions WHERE org_id=?",org);
        if (row.isEmpty()) return;
        String customer=subscription.path("customer").asText();
        String id=subscription.path("id").asText();
        String eventId=event.path("id").asText();
        long occurred=event.path("created").asLong(0);
        if (!customer.startsWith("cus_") || !id.startsWith("sub_") || !eventId.startsWith("evt_") || occurred==0) return;
        var existing=row.getFirst();
        if (existing.get("customer_id")!=null && !customer.equals(existing.get("customer_id"))) return;
        if (existing.get("subscription_id")!=null && !id.equals(existing.get("subscription_id"))) return;
        if (occurred<(long)existing.get("last_event_at")) return;
        if (db.update("INSERT INTO stripe_events(id,org_id) VALUES (?,?) ON CONFLICT DO NOTHING",eventId,org)==0) return;
        String subscriptionStatus=subscription.path("status").asText();
        boolean ending="customer.subscription.deleted".equals(type)||Set.of("canceled","incomplete_expired").contains(subscriptionStatus);
        String price=subscription.path("items").path("data").path(0).path("price").path("id").asText();
        String mapped=price.startsWith("price_") && price.equals(professional)?"Professional":price.startsWith("price_") && price.equals(enterprise)?"Enterprise":null;
        String plan=ending||"unpaid".equals(subscriptionStatus)?"Free":Set.of("active","trialing","past_due").contains(subscriptionStatus)?mapped:null;
        db.update("""
            UPDATE stripe_subscriptions SET customer_id=?,subscription_id=?,last_event_at=?,checkout_url=NULL,checkout_expires=NULL WHERE org_id=?
            """,customer,ending?null:id,occurred,org);
        if (plan!=null && !plan.equals(orgRow.getFirst().get("plan"))) {
            db.update("UPDATE organizations SET plan=? WHERE id=?",plan,org);
            tenants.audit(org,null,"subscription.updated",plan);
            events.add(org,"subscription.updated",Map.of("plan",plan,"provider","stripe-test"));
        }
    }

    private boolean enabled() {return "stripe-test".equals(billing) && (key.startsWith("sk_test_") || key.startsWith("rk_test_"));}

    private JsonNode stripe(String endpoint,Map<String,String> fields,String idempotency) {
        var form=fields.entrySet().stream().sorted(Map.Entry.comparingByKey()).map(entry->encode(entry.getKey())+"="+encode(entry.getValue())).collect(Collectors.joining("&"));
        var request=HttpRequest.newBuilder(URI.create("https://api.stripe.com/v1/"+endpoint)).timeout(Duration.ofSeconds(8))
            .header("Authorization","Bearer "+key).header("Content-Type","application/x-www-form-urlencoded");
        if (idempotency!=null) request.header("Idempotency-Key",idempotency);
        try {
            var response=client.send(request.POST(HttpRequest.BodyPublishers.ofString(form)).build(),HttpResponse.BodyHandlers.ofString());
            if (response.statusCode()/100!=2) throw status(HttpStatus.BAD_GATEWAY,"Stripe refused the test billing request.");
            return json.readTree(response.body());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw status(HttpStatus.BAD_GATEWAY,"The Stripe request was interrupted.");
        } catch (java.io.IOException error) {
            throw status(HttpStatus.BAD_GATEWAY,"Stripe test billing is temporarily unavailable.");
        }
    }
    private static String encode(String value) {return URLEncoder.encode(value,StandardCharsets.UTF_8);}
    private static String url(JsonNode response,String host) {
        String value=response.path("url").asText();
        try {
            var link=URI.create(value);
            if ("https".equals(link.getScheme()) && host.equals(link.getHost())) return value;
        } catch (IllegalArgumentException ignored) {}
        throw status(HttpStatus.BAD_GATEWAY,"Stripe returned an invalid billing link.");
    }
}

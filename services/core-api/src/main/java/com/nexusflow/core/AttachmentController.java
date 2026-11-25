package com.nexusflow.core;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.exception.SdkException;
import static com.nexusflow.core.AuthController.status;

@RestController
@RequestMapping("/api/orgs/{org}/tasks/{task}/attachments")
class AttachmentController {
    private static final int LIMIT=5*1024*1024;
    private final JdbcTemplate db;
    private final Tenants tenants;
    private final TaskRepository tasks;
    private final ObjectStorage objects;

    AttachmentController(JdbcTemplate db,Tenants tenants,TaskRepository tasks,ObjectStorage objects) {
        this.db=db;this.tenants=tenants;this.tasks=tasks;this.objects=objects;
    }

    @GetMapping
    Map<String,Object> list(@PathVariable UUID org,@PathVariable UUID task,@AuthenticationPrincipal Sessions.User user) {
        authorize(org,task,user,false);
        return Map.of("configured",objects.configured(),"files",db.queryForList("""
            SELECT id,name,size_bytes AS "size",created_at AS "createdAt" FROM attachments WHERE org_id=? AND task_id=? ORDER BY created_at DESC LIMIT 100
            """,org,task));
    }

    @PostMapping(consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> upload(@PathVariable UUID org,@PathVariable UUID task,@AuthenticationPrincipal Sessions.User user,@RequestPart("file") MultipartFile file) throws IOException {
        authorize(org,task,user,true);
        if (file.isEmpty()||file.getSize()>LIMIT) throw status(HttpStatus.BAD_REQUEST,"Upload one file up to 5 MB.");
        String name=Optional.ofNullable(file.getOriginalFilename()).orElse("").strip();
        if (!name.matches("[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,159}") || name.contains(".."))
            throw status(HttpStatus.BAD_REQUEST,"Use a file name with letters, numbers, spaces, dots, underscores, or hyphens.");
        byte[] bytes=file.getBytes();
        String type=mediaType(name,bytes);
        UUID id=UUID.randomUUID();
        String key=key(org,task,id);
        try {objects.put(key,bytes,type);}
        catch (SdkException error) {throw status(HttpStatus.SERVICE_UNAVAILABLE,"Object storage is temporarily unavailable.");}
        try {
            db.update("INSERT INTO attachments(id,org_id,task_id,uploader,name,media_type,size_bytes) VALUES (?,?,?,?,?,?,?)",
                id,org,task,user.id(),name,type,bytes.length);
        } catch (RuntimeException error) {
            try {objects.delete(key);} catch (SdkException cleanup) {error.addSuppressed(cleanup);}
            throw error;
        }
        return Map.of("id",id,"name",name,"size",bytes.length);
    }

    @GetMapping("/{id}")
    ResponseEntity<byte[]> download(@PathVariable UUID org,@PathVariable UUID task,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user) {
        authorize(org,task,user,false);
        var file=db.queryForList("SELECT name,size_bytes FROM attachments WHERE org_id=? AND task_id=? AND id=?",org,task,id)
            .stream().findFirst().orElseThrow(()->status(HttpStatus.NOT_FOUND,"Attachment could not be found."));
        try {
            byte[] content=objects.get(key(org,task,id));
            if (content.length != (long)file.get("size_bytes")) throw status(HttpStatus.BAD_GATEWAY,"Attachment content was incomplete.");
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename((String)file.get("name")).build().toString())
                .header("X-Content-Type-Options","nosniff").cacheControl(CacheControl.noStore()).body(content);
        } catch (SdkException error) {throw status(HttpStatus.SERVICE_UNAVAILABLE,"Object storage is temporarily unavailable.");}
    }

    static String mediaType(String name,byte[] bytes) {
        String lower=name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png") && starts(bytes,new byte[]{(byte)0x89,80,78,71,13,10,26,10})) return "image/png";
        if ((lower.endsWith(".jpeg")||lower.endsWith(".jpg")) && starts(bytes,new byte[]{(byte)0xff,(byte)0xd8,(byte)0xff})) return "image/jpeg";
        if (lower.endsWith(".pdf") && starts(bytes,"%PDF-".getBytes(StandardCharsets.US_ASCII))) return "application/pdf";
        if (lower.endsWith(".txt")) {
            try {
                var preview=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes));
                if (preview.chars().noneMatch(c->c<32&&c!='\r'&&c!='\n'&&c!='\t')) return "text/plain";
            } catch (CharacterCodingException ignored) {}
        }
        throw status(HttpStatus.UNSUPPORTED_MEDIA_TYPE,"Upload a PNG, JPG, PDF, or UTF-8 text file with matching content.");
    }

    private static boolean starts(byte[] full,byte[] prefix) {
        return full.length>=prefix.length && Arrays.equals(full,0,prefix.length,prefix,0,prefix.length);
    }

    private void authorize(UUID org,UUID task,Sessions.User user,boolean writable) {
        if (writable) tenants.require(org,user,Tenants.CONTRIBUTE); else tenants.require(org,user);
        if (!tasks.existsByIdAndOrgId(task,org)) throw status(HttpStatus.NOT_FOUND,"Task could not be found.");
    }

    private static String key(UUID org,UUID task,UUID id) {return "objects/"+org+"/tasks/"+task+"/"+id;}
}

package com.nexusflow.core;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail invalid(MethodArgumentNotValidException error) {
        var field = error.getBindingResult().getFieldError();
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,field==null?"Invalid request.":field.getField()+" "+field.getDefaultMessage()+".");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail conflict() {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,"The change conflicts with workspace data or constraints.");
    }
}

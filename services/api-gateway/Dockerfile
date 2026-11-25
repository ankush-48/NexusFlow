FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /source
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre-alpine@sha256:5d7689f47d670aca766b9503a70bccc2d73b4eb9221ae8f714ae958313c4ce70
RUN addgroup -S nexusflow && adduser -S nexusflow -G nexusflow
WORKDIR /app
COPY --from=build --chown=nexusflow:nexusflow /source/target/api-gateway-0.1.0.jar app.jar
USER nexusflow
EXPOSE 8080
ENTRYPOINT ["java","-jar","app.jar"]

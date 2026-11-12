# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOOS=linux GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags "-s -w" -o /out/server ./cmd/server \
 && mkdir -p /out/data/media

# distroless/static: CA certificates + tzdata-free (time/tzdata is embedded),
# no shell, runs as uid 65532.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=build --chown=65532:65532 /out/data /data
ENV PORT=8080 MEDIA_DIR=/data/media APP_ENV=production
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/server"]
CMD ["serve"]

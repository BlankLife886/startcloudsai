FROM golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d

RUN apk add --no-cache ca-certificates tzdata

RUN addgroup -S app && adduser -S -G app app

WORKDIR /app
COPY --from=build /out/server /app/server

USER app

EXPOSE 8000

# server:  /app/server serve   （启动时自动执行 goose 迁移，migrations 已 embed）
# worker:  /app/server worker
CMD ["/app/server", "serve"]

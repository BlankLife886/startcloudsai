FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=build /out/server /app/server

EXPOSE 8000

# server:  /app/server serve   （启动时自动执行 goose 迁移，migrations 已 embed）
# worker:  /app/server worker
CMD ["/app/server", "serve"]

# Template Dockerfile.
# Agent must customize this based on the app's runtime (Node.js, Python, Go, etc.)
# Place the final Dockerfile in the app's root directory, not here.

# Example: Node.js
# FROM node:20-alpine
# WORKDIR /app
# COPY package*.json .
# RUN npm ci --only=production
# COPY . .
# EXPOSE 8080
# CMD ["node", "dist/index.js"]

# Example: Python
# FROM python:3.12-slim
# WORKDIR /app
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt
# COPY . .
# EXPOSE 8080
# CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]

# Example: Go
# FROM golang:1.22-alpine AS builder
# WORKDIR /app
# COPY go.mod go.sum ./
# RUN go mod download
# COPY . .
# RUN CGO_ENABLED=0 go build -o /app/server
# FROM alpine:3.19
# COPY --from=builder /app/server /server
# EXPOSE 8080
# CMD ["/server"]

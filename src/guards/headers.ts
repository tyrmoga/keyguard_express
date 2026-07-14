import helmet from "helmet"

export function headers() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
}

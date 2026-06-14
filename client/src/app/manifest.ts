import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mini HAS",
    short_name: "Mini HAS",
    description: "Controle local da sua casa inteligente",
    start_url: "/",
    display: "standalone",
    background_color: "#171717",
    theme_color: "#171717",
  }
}

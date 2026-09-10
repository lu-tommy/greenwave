import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Green Wave — Signal-Aware Speed Advisory",
    short_name: "Green Wave",
    description: "Predicts upcoming traffic signal phases and recommends a legal, smooth speed to catch a sequence of greens.",
    start_url: "/drive",
    display: "standalone",
    background_color: "#0a0b0d",
    theme_color: "#0a0b0d",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png" },
      { src: "/icon-512", sizes: "512x512", type: "image/png" },
    ],
  };
}

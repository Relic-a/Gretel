import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Matches the red "G" mark used in the app title bar and auth screen. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#e44232",
          color: "#ffffff",
          fontSize: 44,
          fontWeight: 900,
          letterSpacing: "-0.04em"
        }}
      >
        G
      </div>
    ),
    size
  );
}

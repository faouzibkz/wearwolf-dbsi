import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        night: {
          50: "#f5f6fa",
          100: "#e8e3d8",
          950: "#05060a",
          900: "#0b0e17",
          800: "#131829",
          700: "#1c2338",
          600: "#2a3350",
        },
        blood: {
          500: "#8b1e2b",
          400: "#a5283a",
          300: "#c23a4f",
        },
        gold: {
          400: "#d4af37",
          300: "#e6c75e",
        },
      },
      fontFamily: {
        display: ["Cinzel", "Georgia", "serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "fade-in": "fadeIn 0.6s ease-out",
        "pulse-slow": "pulse 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

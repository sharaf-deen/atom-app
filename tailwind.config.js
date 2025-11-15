/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'], // prêt si tu veux un dark mode plus tard
  content: ["./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg))",
        fg: "hsl(var(--fg))",
        muted: "hsl(var(--muted))",
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
        card: "hsl(var(--card))",
        cardfg: "hsl(var(--cardfg))",
        // alias utiles
        atom: {
          black: "#0A0A0A",
          white: "#FFFFFF",
          gray: {
            50:  "#FAFAFA",
            100: "#F5F5F5",
            200: "#E5E5E5",
            300: "#D4D4D4",
            400: "#A3A3A3",
            500: "#737373",
            600: "#525252",
            700: "#404040",
            800: "#262626",
            900: "#171717",
          },
        },
      },
      borderRadius: {
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.05), 0 6px 20px rgba(0,0,0,0.06)",
        md:   "0 2px 6px rgba(0,0,0,0.06), 0 10px 30px rgba(0,0,0,0.08)",
        lg:   "0 4px 10px rgba(0,0,0,0.08), 0 18px 40px rgba(0,0,0,0.10)",
        focus:"0 0 0 2px hsl(var(--bg)) , 0 0 0 4px hsl(var(--ring))",
      },
      ringColor: {
        DEFAULT: "hsl(var(--ring))",
      },
      ringOffsetColor: {
        DEFAULT: "hsl(var(--bg))",
      },
      transitionTimingFunction: {
        soft: "cubic-bezier(.2,.8,.2,1)", // smooth
      },
    },
    container: {
      center: true,
      padding: "1rem",
      screens: { sm:"640px", md:"768px", lg:"1024px", xl:"1280px", "2xl":"1400px" },
    },
    fontFamily: {
      sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
        body: ['DM Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Task-specific action colors
        "task-stake": {
          DEFAULT: "hsl(var(--task-stake))",
          foreground: "hsl(var(--task-stake-foreground))",
        },
        "task-claim": {
          DEFAULT: "hsl(var(--task-claim))",
          foreground: "hsl(var(--task-claim-foreground))",
        },
        "task-unclaim": {
          DEFAULT: "hsl(var(--task-unclaim))",
          foreground: "hsl(var(--task-unclaim-foreground))",
        },
        "task-complete": {
          DEFAULT: "hsl(var(--task-complete))",
          foreground: "hsl(var(--task-complete-foreground))",
        },
        "task-approve": {
          DEFAULT: "hsl(var(--task-approve))",
          foreground: "hsl(var(--task-approve-foreground))",
        },
        "task-cancel": {
          DEFAULT: "hsl(var(--task-cancel))",
          foreground: "hsl(var(--task-cancel-foreground))",
        },
        // Approval/Success indicator
        "approval-success": {
          DEFAULT: "hsl(var(--approval-success))",
          foreground: "hsl(var(--approval-success-foreground))",
        },
        // Status badge colors
        "status-open": {
          DEFAULT: "hsl(var(--status-open))",
          foreground: "hsl(var(--status-open-foreground))",
        },
        "status-stakeholder-needed": {
          DEFAULT: "hsl(var(--status-stakeholder-needed))",
          foreground: "hsl(var(--status-stakeholder-needed-foreground))",
        },
        "status-in-progress": {
          DEFAULT: "hsl(var(--status-in-progress))",
          foreground: "hsl(var(--status-in-progress-foreground))",
        },
        "status-completed": {
          DEFAULT: "hsl(var(--status-completed))",
          foreground: "hsl(var(--status-completed-foreground))",
        },
        "status-approved": {
          DEFAULT: "hsl(var(--status-approved))",
          foreground: "hsl(var(--status-approved-foreground))",
        },
        "status-closed": {
          DEFAULT: "hsl(var(--status-closed))",
          foreground: "hsl(var(--status-closed-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'spring-out': 'cubic-bezier(0.4, 0, 1, 1)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "page-entrance": "pageEntrance 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "slide-up": "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "modal-in": "modalScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "modal-out": "modalScaleOut 0.15s cubic-bezier(0.4, 0, 1, 1) forwards",
        "badge-pulse": "badgePulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

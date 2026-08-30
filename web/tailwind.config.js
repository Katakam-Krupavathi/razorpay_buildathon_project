/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        razorpay: {
          blue: '#0c2340',
          accent: '#3395ff',
          light: '#f4f8fa',
        },
      },
    },
  },
  plugins: [],
};

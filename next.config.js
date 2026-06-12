/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ["pdfkit", "fontkit", "exceljs"] },
};
module.exports = nextConfig;

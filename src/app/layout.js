export const metadata = {
  title: "Tally",
  description: "Less in the bag. More on the road.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}

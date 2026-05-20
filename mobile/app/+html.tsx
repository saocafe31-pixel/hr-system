import { ScrollViewStyleReset } from 'expo-router/html';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/*
          ล็อกซูมระดับหน้า (กันโฟกัสช่องพิมพ์แล้วเลย์เอาต์เพี้ยน) + ฟอนต์ input 16px ด้านล่าง
          การขยายรูปทำด้วย pinch บน ZoomableImage (transform) ไม่ใช่ซูม viewport
        */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />

        {/* 
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native. 
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Using raw CSS styles as an escape-hatch to ensure the background color never flickers in dark-mode. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        {/* Add any additional <head> elements that you want globally available on web... */}
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  background-color: #121212;
  -webkit-text-size-adjust: 100%;
}
/* iOS จะซูมช่องพิมพ์ถ้าฟอนต์ต่ำกว่า ~16px */
input, textarea, select {
  font-size: 16px !important;
}
`;

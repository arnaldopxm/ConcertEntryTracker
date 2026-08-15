// Los módulos de Firebase se importan por URL desde gstatic, porque la app no
// tiene bundler. TypeScript no sabe resolver una URL como especificador, así que
// aquí la mapeamos al paquete npm equivalente.
//
// `firebase` está en devDependencies y clavado a la MISMA versión que la URL
// (10.12.2): solo aporta los tipos, nunca se empaqueta ni se sirve.
// Si subes la versión de la URL en store.js, sube también la del package.json.

declare module 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js' {
  export * from 'firebase/app';
}

declare module 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js' {
  export * from 'firebase/auth';
}

declare module 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js' {
  export * from 'firebase/firestore';
}

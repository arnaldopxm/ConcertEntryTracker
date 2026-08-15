// Configuración de Firebase.
//
// Este es el ÚNICO archivo que tienes que tocar para poner la app en marcha.
// Copia aquí el objeto que te da la consola de Firebase en:
//   Configuración del proyecto > Tus apps > App web > Configuración del SDK
//
// La apiKey es pública y es correcto que lo sea: identifica al proyecto, no
// autoriza nada por sí sola. La seguridad real vive en firestore.rules.

export const firebaseConfig = {
  apiKey: 'AIzaSyCe6D06IaTrj8wzZE7FX1X2kneX-ykCbWs',
  authDomain: 'taquilla-18de2.firebaseapp.com',
  projectId: 'taquilla-18de2',
  storageBucket: 'taquilla-18de2.firebasestorage.app',
  messagingSenderId: '677117565266',
  appId: '1:677117565266:web:6cd927c1bfaef50f20828b'
};

// Detecta si el archivo sigue sin rellenar, para avisar en pantalla en vez de
// dejar que el SDK falle con un error incomprensible.
export function configPendiente() {
  return Object.values(firebaseConfig).some(
    (v) => typeof v !== 'string' || v.startsWith('PEGA_AQUI')
  );
}

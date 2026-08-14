// Configuración de Firebase.
//
// Este es el ÚNICO archivo que tienes que tocar para poner la app en marcha.
// Copia aquí el objeto que te da la consola de Firebase en:
//   Configuración del proyecto > Tus apps > App web > Configuración del SDK
//
// La apiKey es pública y es correcto que lo sea: identifica al proyecto, no
// autoriza nada por sí sola. La seguridad real vive en firestore.rules.

export const firebaseConfig = {
  apiKey: 'PEGA_AQUI_apiKey',
  authDomain: 'PEGA_AQUI_authDomain',
  projectId: 'PEGA_AQUI_projectId',
  storageBucket: 'PEGA_AQUI_storageBucket',
  messagingSenderId: 'PEGA_AQUI_messagingSenderId',
  appId: 'PEGA_AQUI_appId'
};

// Detecta si el archivo sigue sin rellenar, para avisar en pantalla en vez de
// dejar que el SDK falle con un error incomprensible.
export function configPendiente() {
  return Object.values(firebaseConfig).some(
    (v) => typeof v !== 'string' || v.startsWith('PEGA_AQUI')
  );
}

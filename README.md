# Jabil DR Productivity Dashboard

Un dashboard de productividad en tiempo real diseñado para entornos de manufactura, optimizado para ser usado como PWA en kioscos y dispositivos móviles.

## Características
- **Sincronización en Tiempo Real**: Usa Firebase Realtime Database para mantener todos los dispositivos actualizados instantáneamente.
- **Registro Inteligente**: Soporta escaneo de códigos de barras para registros rápidos.
- **Gestión de Técnicos**: Área administrativa protegida con Clave Maestra para gestionar el personal.
- **Exportación de Datos**: Generación de reportes detallados en formato CSV.
- **Modo Oscuro/Claro**: Interfaz premium adaptable.

## Configuración Online
Este proyecto está diseñado para funcionar en **GitHub Pages**.

### Paso 1: Configurar Firebase
1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Crea una **Realtime Database** (selecciona el modo de prueba inicialmente).
3. Agrega una Web App al proyecto y copia las credenciales.
4. Pega las credenciales en el bloque `firebaseConfig` dentro de `index.html`.

### Paso 2: Subir a GitHub
1. Crea un repositorio nuevo en GitHub.
2. Sube los archivos `index.html`, `style.css` y `app.js`.
3. Ve a **Settings > Pages** y activa el despliegue desde la rama `main`.

---
*Desarrollado para la optimización de procesos de reparación de PCBA.*

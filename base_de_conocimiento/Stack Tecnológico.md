# Stack Tecnológico

Especificación de las herramientas y capas de software utilizadas en el desarrollo del sistema **Inversiones Tata Liñán**:

- **Framework**: Next.js ^15.3.3 utilizando arquitectura App Router, combinando Server Components y Client Components.
- **Base de Datos**: PostgreSQL utilizando el esquema aislado de nombre `administrativo`.
- **Acceso a Base de Datos**: Doble modo dinámico configurado en `lib/db.js`. Utiliza un pool de `pg` directo para desarrollo local, o un proxy HTTP (`PROXY_URL` + `PROXY_API_KEY`) optimizado para entornos Cloud con reintentos y mitigación de cold starts.
- **Autenticación y Seguridad**: Implementación de JSON Web Tokens (JWT) mediante la librería `jose` v6. Se almacena del lado del cliente en una cookie HttpOnly llamada `itl_session` con una expiración de 8 horas.
- **Estilos Visuales**: Tailwind CSS v3.
- **Gráficas de Tableros**: Chart.js 4 integrado con la biblioteca adaptadora `react-chartjs-2`.
- **Manejo e Importación de Archivos**: Manipulación de plantillas Excel a través de SheetJS (`xlsx`).
- **Generación de Identificadores**: Identificadores únicos UUID v4 controlados mediante `uuid` ^11.
- **Encriptación de Contraseñas**: Hashing seguro por medio de `bcryptjs` ^3.
- **Middleware**: Interceptor nativo de Next.js (`middleware.js`) encargado de la verificación de firmas JWT en cada ruta protegida.
- **Plataforma de Despliegue**: Servidores Serverless de Vercel, parametrizando un `maxDuration` de 60 segundos en `vercel.json` para rutas bajo `app/api/**`.
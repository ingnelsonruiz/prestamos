# CLAUDE.md — Base de Conocimiento Principal: Programa Créditos

> Sistema web de gestión de créditos, empeños y fiados para una empresa prestamista (Inversiones Tata Liñán).
> Stack: Next.js 15 (App Router) + PostgreSQL + Tailwind CSS.

---

## 🔄 Protocolo de Actualización de la Base de Conocimiento

Para garantizar que esta base de conocimiento en Obsidian se mantenga íntegra, estructurada y útil para el desarrollo, se debe seguir el siguiente flujo de manejo de archivos ante cualquier actualización:

1. **Actualización Modular Absoluta**: No se debe acumular información en un solo archivo masivo. Si el cambio técnico afecta la estructura de datos o migraciones, se modifica únicamente `[[Base de Datos]]`. Si se altera un flujo transaccional o lógica de cobros, se edita `[[Flujos de Negocio]]`.
2. **Registro Obligatorio de Incidentes y Bugs**: Cada error crítico solucionado en producción (como bloqueos de conexiones o desajustes de fechas) debe registrarse con su fecha, síntoma, causa y corrección exacta en el módulo correspondiente o en un historial de control. Esto previene regresiones en el código y mantiene el contexto del equipo vivo.
3. **Mantenimiento de Enlaces Internos (Wiki Links)**: Al agregar una nueva funcionalidad, tipo de crédito o endpoint, se debe enlazar usando la sintaxis de corchetes dobles `[[Nombre de la Nota]]` para mantener saludable el Grafo de conexiones de Obsidian.
4. **Sincronización con el Código**: Los nombres de esquemas (ej. `administrativo`), prefijos de tablas (`cred_`), constantes, códigos de error y respuestas de endpoints de la API deben transcribirse de manera exacta a como están implementados en el código de Next.js.

---

## 🗺️ Índice de la Bóveda

Selecciona un módulo para explorar la documentación técnica detallada del sistema:

- [[Stack Tecnológico]]: Framework, librerías de entorno, hashing y herramientas de despliegue.
- [[Estructura de Directorios]]: Mapa jerárquico completo de carpetas y archivos del proyecto.
- [[Base de Datos]]: Esquema, diccionarios de tablas principales, restricciones y ciclo de migraciones SQL.
- [[API Endpoints]]: Catálogo completo de rutas de backend organizadas por responsabilidades operativas.
- [[Lógica Financiera y Calificación]]: Modelos matemáticos de amortización (Plano/Francés) y score dinámico de clientes.
- [[Flujos de Negocio]]: Procesos detallados de cobro, liquidaciones, congelamientos e historial de incidentes de infraestructura.
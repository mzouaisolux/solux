// =====================================================================
// Spanish catalog — PARTIAL on purpose (owner: "préparer es, partiel au
// début"). Any missing key falls back to en.ts automatically, so the app
// stays fully usable in Spanish-with-English-gaps until completed.
// =====================================================================

export const es: Record<string, string> = {
  // ---- common actions ----
  "action.save": "Guardar",
  "action.save_changes": "Guardar",
  "action.cancel": "Cancelar",
  "action.delete": "Eliminar",
  "action.edit": "Editar",
  "action.create": "Crear",
  "action.open": "Abrir",
  "action.open_arrow": "Abrir →",
  "action.close": "Cerrar",
  "action.confirm": "Confirmar",
  "action.back": "Volver",
  "action.view_all": "Ver todo",
  "action.done": "Hecho",
  "action.search": "Buscar",
  "common.unassigned": "Sin asignar",
  "common.language": "Idioma",

  // ---- navigation: categories ----
  "nav.cat.dashboard": "Panel",
  "nav.cat.clients_projects": "Clientes y Proyectos",
  "nav.cat.task_lists": "Listas de tareas",
  "nav.cat.orders": "Pedidos",
  "nav.cat.pricing": "Precios",
  "nav.cat.admin": "Admin",

  // ---- dashboard (core) ----
  "dashboard.greeting": "Buenos días, {name}",
  "dashboard.tab.sales": "Ventas",
  "dashboard.tab.operations": "Operaciones",
  "dashboard.scope.my": "Mis elementos",
  "dashboard.scope.all": "Todos",
  "dashboard.bucket.critical": "Crítico — atender ahora",
  "dashboard.bucket.due_today": "Para hoy",
  "dashboard.bucket.preventive": "Preventivo — próximos {days} días",
  // (remaining keys fall back to English)

  // ---- operations tab + action center ----
  "ops.key_numbers": "Cifras clave",
  "ops.revenue_in_production": "Ingresos en producción",
  "ops.active_orders": "Pedidos activos",
  "ops.awaiting_deposit": "Anticipo pendiente",
  "ops.delayed_overdue": "Retrasado / vencido",
  "ops.business_snapshot": "Resumen de negocio",
  "ac.section.urgent": "Urgente",
  "ac.section.waiting_me": "Esperándome",
  "ac.section.waiting_client": "Esperando al cliente",
  "ac.section.info_missing": "Información por completar",
  "ac.empty": "Nada requiere tu atención por ahora.",

  // ---- orders in flight ----
  "oif.title": "Pedidos en curso",
  "oif.subtitle": "{n} activos · etapa operativa en vivo",
  "oif.no_products": "Sin productos",
  "oif.units": "unidades",
  "common.more": "más",
  "common.view_all_arrow": "Ver todo →",

  // ---- prospects & licitaciones ----
  "prospects.universe.tenders_title": "Licitaciones",
  "prospects.tab.projects": "Proyectos",
  "prospects.tab.companies": "Empresas",

  // ---- panel proyectos ----
  "attrib.eyebrow": "Proyectos — licitaciones adjudicadas",
  "attrib.all_funders": "Todos los financiadores",
  "attrib.assigned": "Asignado:",
  "attrib.published": "Publicado",
};

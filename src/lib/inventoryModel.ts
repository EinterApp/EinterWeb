/**
 * Modelo Predictivo de Reabastecimiento — BodegaEinter
 * Basado en ModeloMatematico.py v1.1
 *
 * Calcula semáforo de inventario, demanda diaria ponderada,
 * pedidos sugeridos y resumen de llenado de contenedores.
 */

// ─── Parámetros configurables ─────────────────────────────────────────────────

export interface ModelParams {
  leadTimeDias: number;        // días que tarda llegar un pedido (default 60)
  diasObjetivo: number;        // días de cobertura ideal (default 150)
  alertaRojo: number;          // días < este valor → CRÍTICO (default 60)
  alertaAmarillo: number;      // días < este valor → ALERTA (default 80)
  minPzsSku: number;           // mínimo de piezas por SKU en cualquier pedido (default 2000)
  tipoContenedor: '20' | '40' | '40HC';
}

export const DEFAULT_PARAMS: ModelParams = {
  leadTimeDias: 60,
  diasObjetivo: 150,
  alertaRojo: 60,
  alertaAmarillo: 80,
  minPzsSku: 2000,
  tipoContenedor: '40HC',
};

export const CONTENEDORES: Record<string, { pesoMaxKg: number; volumenM3: number }> = {
  '20':   { pesoMaxKg: 21_700, volumenM3: 33.0 },
  '40':   { pesoMaxKg: 26_500, volumenM3: 67.0 },
  '40HC': { pesoMaxKg: 26_500, volumenM3: 76.0 },
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SemaforoStatus = 'rojo' | 'amarillo' | 'verde' | 'sin_datos' | 'sobrestock';

export interface ProductoInput {
  sku: string;
  name: string;
  supplier: string;
  supplierId?: number;
  stock: number;
  weightKg: number;
  standardTarima?: number;
  dimensionsCm?: { largo: number; ancho: number; alto: number };
  pzsEnTransito: number;
  demandaDiaria: number; // piezas/día — 0 si no se conoce
}

export interface ProductoResultado extends ProductoInput {
  invEfectivo: number;
  diasInventario: number;      // 9999 = sin demanda
  semaforo: SemaforoStatus;
  sobrestock: boolean;
  diasARojo: number | null;    // días hasta entrar a zona roja
  fechaRojo: string | null;    // fecha estimada de zona roja
  pzsNecesarias: number;       // piezas a pedir (cálculo crudo)
  pzsAPedir: number;           // piezas a pedir (redondeado a tarima)
  pesoKg: number;              // peso estimado del pedido
  volumenM3: number;           // volumen estimado del pedido
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Calcula volumen en m³ a partir de dimensiones en cm (largo × ancho × alto / 1_000_000) */
export function calcularVolumenM3(
  dims?: { largo: number; ancho: number; alto: number }
): number {
  if (!dims) return 0;
  const { largo, ancho, alto } = dims;
  if (!largo || !ancho || !alto) return 0;
  return (largo * ancho * alto) / 1_000_000;
}

// ─── Motor de cálculo principal ───────────────────────────────────────────────

/**
 * Aplica el modelo a un array de productos y retorna los resultados calculados.
 * Para SKUs sin demanda (demandaDiaria = 0) el semáforo es 'sin_datos'.
 */
export function calcularResultados(
  inputs: ProductoInput[],
  params: ModelParams
): ProductoResultado[] {
  return inputs.map((p) => {
    const demanda = p.demandaDiaria;
    const transit = p.pzsEnTransito;
    const invEfectivo = p.stock + transit;

    // Días de cobertura basados en inventario efectivo
    const diasInventario =
      demanda > 0 ? Math.round((invEfectivo / demanda) * 10) / 10 : 9999;

    // Sobrestock si supera 2× el objetivo
    const umbralSobrestock = params.diasObjetivo * 2;
    const esSobrestock =
      demanda === 0 ? false : diasInventario > umbralSobrestock;

    // Semáforo
    let semaforo: SemaforoStatus;
    if (demanda === 0) {
      semaforo = 'sin_datos';
    } else if (esSobrestock) {
      semaforo = 'sobrestock';
    } else if (diasInventario < params.alertaRojo) {
      semaforo = 'rojo';
    } else if (diasInventario < params.alertaAmarillo) {
      semaforo = 'amarillo';
    } else {
      semaforo = 'verde';
    }

    // Fecha estimada de entrada a zona roja (solo para verdes)
    let diasARojo: number | null = null;
    let fechaRojo: string | null = null;
    if (semaforo === 'verde' && demanda > 0) {
      const d = diasInventario - params.alertaRojo;
      if (d > 0) {
        diasARojo = Math.round(d);
        const fecha = new Date();
        fecha.setDate(fecha.getDate() + diasARojo);
        fechaRojo = fecha.toLocaleDateString('es-MX', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
      }
    }

    // Cálculo de pedido (solo para rojo/amarillo)
    let pzsNecesarias = 0;
    let pzsAPedir = 0;
    let pesoKg = 0;
    let volumenM3 = 0;

    if ((semaforo === 'rojo' || semaforo === 'amarillo') && demanda > 0) {
      // Inventario proyectado al momento de recepción
      const invEnRecepcion = Math.max(
        0,
        invEfectivo - demanda * params.leadTimeDias
      );
      pzsNecesarias = Math.max(
        0,
        demanda * params.diasObjetivo - invEnRecepcion
      );
      // Aplicar mínimo y redondear a múltiplo de tarima
      pzsAPedir = Math.max(pzsNecesarias, params.minPzsSku);
      if (p.standardTarima && p.standardTarima > 0) {
        pzsAPedir =
          Math.ceil(pzsAPedir / p.standardTarima) * p.standardTarima;
      } else {
        pzsAPedir = Math.ceil(pzsAPedir);
      }
      pesoKg = Math.round(pzsAPedir * p.weightKg * 100) / 100;
      volumenM3 =
        Math.round(pzsAPedir * calcularVolumenM3(p.dimensionsCm) * 10000) /
        10000;
    }

    return {
      ...p,
      pzsEnTransito: transit,
      invEfectivo,
      diasInventario,
      semaforo,
      sobrestock: esSobrestock,
      diasARojo,
      fechaRojo,
      pzsNecesarias: Math.round(pzsNecesarias),
      pzsAPedir: Math.round(pzsAPedir),
      pesoKg,
      volumenM3,
    };
  });
}

// ─── Resumen por proveedor (llenado de contenedor) ────────────────────────────

export interface ResumenContenedor {
  supplier: string;
  tipoContenedor: string;
  pesoTotalKg: number;
  volumenTotalM3: number;
  pesoMaxKg: number;
  volMaxM3: number;
  pctPeso: number;
  pctVol: number;
  productos: ProductoResultado[];
}

/**
 * Agrupa los productos en alerta por proveedor y calcula el llenado
 * estimado del contenedor configurado.
 */
export function calcularResumenContenedores(
  resultados: ProductoResultado[],
  params: ModelParams
): ResumenContenedor[] {
  const alertas = resultados.filter(
    (r) => r.semaforo === 'rojo' || r.semaforo === 'amarillo'
  );
  const cont = CONTENEDORES[params.tipoContenedor];

  const bySupplier: Record<string, ProductoResultado[]> = {};
  for (const r of alertas) {
    const s = r.supplier || 'Sin proveedor';
    if (!bySupplier[s]) bySupplier[s] = [];
    bySupplier[s].push(r);
  }

  return Object.entries(bySupplier)
    .map(([supplier, prods]) => {
      const pesoTotal = prods.reduce((sum, p) => sum + p.pesoKg, 0);
      const volTotal = prods.reduce((sum, p) => sum + p.volumenM3, 0);
      return {
        supplier,
        tipoContenedor: params.tipoContenedor,
        pesoTotalKg: Math.round(pesoTotal * 100) / 100,
        volumenTotalM3: Math.round(volTotal * 1000) / 1000,
        pesoMaxKg: cont.pesoMaxKg,
        volMaxM3: cont.volumenM3,
        pctPeso: Math.min(
          999,
          Math.round((pesoTotal / cont.pesoMaxKg) * 1000) / 10
        ),
        pctVol: Math.min(
          999,
          Math.round((volTotal / cont.volumenM3) * 1000) / 10
        ),
        productos: prods,
      };
    })
    .sort((a, b) => b.pesoTotalKg - a.pesoTotalKg);
}

// ─── Utilidades de ordenación ─────────────────────────────────────────────────

const SEMAFORO_ORDER: Record<SemaforoStatus, number> = {
  rojo: 0,
  amarillo: 1,
  verde: 2,
  sin_datos: 3,
  sobrestock: 4,
};

/** Ordena: rojo → amarillo → verde → sin_datos → sobrestock; dentro de c/u por días asc. */
export function sortResultados(
  results: ProductoResultado[]
): ProductoResultado[] {
  return [...results].sort((a, b) => {
    const diff = SEMAFORO_ORDER[a.semaforo] - SEMAFORO_ORDER[b.semaforo];
    if (diff !== 0) return diff;
    return a.diasInventario - b.diasInventario;
  });
}

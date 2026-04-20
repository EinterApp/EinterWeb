import { useState } from "react";
import { useDarkMode } from "../context/DarkModeContext";

// ─── Mock data ────────────────────────────────────────────────────────────────

const kpi = {
  ventasHoy: 8450,
  ventasMes: 187340,
  pedidosPendientes: 7,
  productosMinimo: 6,
};

const ventasDia = [
  { dia: "Lun", monto: 12400 },
  { dia: "Mar", monto: 8900 },
  { dia: "Mié", monto: 15600 },
  { dia: "Jue", monto: 11200 },
  { dia: "Vie", monto: 18900 },
  { dia: "Sáb", monto: 22100 },
  { dia: "Dom", monto: 7300 },
];

const ventasMeses = [
  { mes: "Nov", monto: 142000 },
  { mes: "Dic", monto: 198000 },
  { mes: "Ene", monto: 121000 },
  { mes: "Feb", monto: 155000 },
  { mes: "Mar", monto: 167000 },
  { mes: "Abr", monto: 187340 },
];

const topProductos = [
  { nombre: "Espejo 1 — Rectangular 60×90 cm", unidades: 210 },
  { nombre: "Espejo 2 — Ovalado 50×70 cm", unidades: 145 },
  { nombre: "Espejo 3 — Redondo 60 cm", unidades: 132 },
  { nombre: "Espejo 4 — Marco Dorado 80×120 cm", unidades: 98 },
  { nombre: "Espejo 5 — Biselado 40×60 cm", unidades: 67 },
];

const stockCritico = [
  { nombre: "Espejo 1 — Rectangular 60×90 cm", stock: 3, minimo: 20 },
  { nombre: "Espejo 3 — Redondo 60 cm", stock: 1, minimo: 10 },
  { nombre: "Espejo 6 — Cuerpo Completo 45×150 cm", stock: 2, minimo: 12 },
  { nombre: "Espejo 7 — Veneciano 70×100 cm", stock: 4, minimo: 15 },
  { nombre: "Espejo 8 — Antiguo 50×80 cm", stock: 5, minimo: 18 },
];

const catalogoProductos = [
  { id: "P001", nombre: "Espejo 1 — Rectangular 60×90 cm", codigo: "7501000511248", precio: "$850.00" },
  { id: "P002", nombre: "Espejo 2 — Ovalado 50×70 cm", codigo: "7501000523718", precio: "$620.00" },
  { id: "P003", nombre: "Espejo 3 — Redondo 60 cm", codigo: "7501000589124", precio: "$480.00" },
  { id: "P004", nombre: "Espejo 4 — Marco Dorado 80×120 cm", codigo: "7501000534521", precio: "$1,950.00" },
  { id: "P005", nombre: "Espejo 5 — Biselado 40×60 cm", codigo: "7501000547823", precio: "$390.00" },
];

const impresoras = [
  "Zebra ZD420 (Oficina)",
  "HP LaserJet 1020 (Almacén)",
  "Brother QL-820NWB (Recepción)",
  "Zebra ZP450 (Embarque)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

function barcodePattern(code: string): number[] {
  let n = 0;
  for (let i = 0; i < code.length; i++) {
    n = (n * 31 + code.charCodeAt(i)) >>> 0;
  }
  const bars: number[] = [1, 0, 1];
  for (let i = 0; i < 55; i++) {
    n = (n * 1664525 + 1013904223) >>> 0;
    bars.push((n >>> 28) % 2);
  }
  bars.push(1, 0, 1);
  return bars;
}

// ─── SVG micro-components ─────────────────────────────────────────────────────

function FakeQR({ size = 140 }: { size?: number }) {
  const rows = [
    "1111111011010111111",
    "1000001000101000001",
    "1011101011101011101",
    "1011101001001011101",
    "1011101010001011101",
    "1000001001001000001",
    "1111111010101111111",
    "0000000011000000000",
    "1101011010101101011",
    "0110100101010110100",
    "1001011010110011011",
    "0010100111000010100",
    "1111111001011010111",
    "1000001010100010001",
    "1011101000010110001",
    "1011101010100011001",
    "1011101001010011011",
    "1000001011001010100",
    "1111111010101001101",
  ];
  const cell = size / rows.length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill="white" />
      {rows.map((row, r) =>
        row.split("").map((c, col) =>
          c === "1" ? (
            <rect
              key={`${r}-${col}`}
              x={col * cell}
              y={r * cell}
              width={cell + 0.5}
              height={cell + 0.5}
              fill="#111"
            />
          ) : null
        )
      )}
    </svg>
  );
}

function FakeBarcode({
  code,
  width = 180,
  height = 48,
}: {
  code: string;
  width?: number;
  height?: number;
}) {
  const pattern = barcodePattern(code);
  const barW = width / pattern.length;
  return (
    <svg width={width} height={height + 16} viewBox={`0 0 ${width} ${height + 16}`}>
      {pattern.map((on, i) =>
        on ? (
          <rect key={i} x={i * barW} y={0} width={barW + 0.4} height={height} fill="#111" />
        ) : null
      )}
      <text
        x={width / 2}
        y={height + 13}
        textAnchor="middle"
        fontSize="9"
        fill="#555"
        fontFamily="monospace"
      >
        {code}
      </text>
    </svg>
  );
}

function BarChart() {
  const maxMonto = Math.max(...ventasDia.map((v) => v.monto));
  const W = 400,
    H = 200;
  const padL = 50,
    padR = 10,
    padT = 10,
    padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const spacing = chartW / ventasDia.length;
  const barW = spacing * 0.55;
  const yTicks = [0, 5000, 10000, 15000, 20000];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {yTicks.map((tick) => {
        const y = padT + chartH - (tick / maxMonto) * chartH;
        return (
          <g key={tick}>
            <line
              x1={padL}
              y1={y}
              x2={padL + chartW}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth="1"
              strokeDasharray="4,3"
            />
            <text
              x={padL - 5}
              y={y + 4}
              textAnchor="end"
              fontSize="9"
              fill="#9ca3af"
              fontFamily="sans-serif"
            >
              {tick === 0 ? "0" : `${tick / 1000}k`}
            </text>
          </g>
        );
      })}
      {ventasDia.map((d, i) => {
        const x = padL + i * spacing + (spacing - barW) / 2;
        const barH = (d.monto / maxMonto) * chartH;
        const y = padT + chartH - barH;
        return (
          <g key={d.dia}>
            <rect x={x} y={y} width={barW} height={barH} rx="3" fill="#3b82f6" opacity="0.85" />
            <text
              x={x + barW / 2}
              y={H - padB + 16}
              textAnchor="middle"
              fontSize="10"
              fill="#9ca3af"
              fontFamily="sans-serif"
            >
              {d.dia}
            </text>
          </g>
        );
      })}
      <line
        x1={padL}
        y1={padT + chartH}
        x2={padL + chartW}
        y2={padT + chartH}
        stroke="#d1d5db"
        strokeWidth="1"
      />
      <line
        x1={padL}
        y1={padT}
        x2={padL}
        y2={padT + chartH}
        stroke="#d1d5db"
        strokeWidth="1"
      />
    </svg>
  );
}

function LineChart() {
  const maxMonto = 210000;
  const W = 400,
    H = 200;
  const padL = 55,
    padR = 15,
    padT = 10,
    padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const yTicks = [0, 50000, 100000, 150000, 200000];

  const pts = ventasMeses.map((d, i) => ({
    x: padL + (i / (ventasMeses.length - 1)) * chartW,
    y: padT + chartH - (d.monto / maxMonto) * chartH,
    mes: d.mes,
  }));

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${padT + chartH} L ${pts[0].x} ${padT + chartH} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {yTicks.map((tick) => {
        const y = padT + chartH - (tick / maxMonto) * chartH;
        return (
          <g key={tick}>
            <line
              x1={padL}
              y1={y}
              x2={padL + chartW}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth="1"
              strokeDasharray="4,3"
            />
            <text
              x={padL - 5}
              y={y + 4}
              textAnchor="end"
              fontSize="9"
              fill="#9ca3af"
              fontFamily="sans-serif"
            >
              {tick === 0 ? "0" : `${tick / 1000}k`}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill="#3b82f6" opacity="0.07" />
      <path
        d={linePath}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map((p) => (
        <circle
          key={p.mes}
          cx={p.x}
          cy={p.y}
          r="4"
          fill="white"
          stroke="#3b82f6"
          strokeWidth="2"
        />
      ))}
      {pts.map((p) => (
        <text
          key={p.mes}
          x={p.x}
          y={H - padB + 16}
          textAnchor="middle"
          fontSize="10"
          fill="#9ca3af"
          fontFamily="sans-serif"
        >
          {p.mes}
        </text>
      ))}
      <line
        x1={padL}
        y1={padT + chartH}
        x2={padL + chartW}
        y2={padT + chartH}
        stroke="#d1d5db"
        strokeWidth="1"
      />
      <line
        x1={padL}
        y1={padT}
        x2={padL}
        y2={padT + chartH}
        stroke="#d1d5db"
        strokeWidth="1"
      />
    </svg>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  icon,
  accent,
  delta,
}: {
  title: string;
  value: string;
  icon: string;
  accent: string;
  delta: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {title}
        </p>
        <span className={`text-base ${accent} p-1.5 rounded-lg`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{delta}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Home() {
  useDarkMode();

  const [qrProductIdx, setQrProductIdx] = useState(0);
  const [qrPrinterIdx, setQrPrinterIdx] = useState(0);
  const [qrMsg, setQrMsg] = useState("");

  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [labelPrinterIdx, setLabelPrinterIdx] = useState(0);
  const [labelMsg, setLabelMsg] = useState("");
  const [showBarcodePreview, setShowBarcodePreview] = useState(false);

  const toggleLabel = (id: string) => {
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllLabels = () => {
    if (selectedLabels.size === catalogoProductos.length) {
      setSelectedLabels(new Set());
    } else {
      setSelectedLabels(new Set(catalogoProductos.map((p) => p.id)));
    }
  };

  const handlePrintQR = () => {
    const prod = catalogoProductos[qrProductIdx];
    setQrMsg(`Enviando QR de "${prod.nombre}" a ${impresoras[qrPrinterIdx]}…`);
    setTimeout(
      () => setQrMsg(`✓ QR enviado correctamente a ${impresoras[qrPrinterIdx]}.`),
      1500
    );
  };

  const handlePrintLabels = () => {
    if (selectedLabels.size === 0) return;
    setLabelMsg(
      `Enviando ${selectedLabels.size} etiqueta(s) a ${impresoras[labelPrinterIdx]}…`
    );
    setTimeout(
      () =>
        setLabelMsg(
          `✓ ${selectedLabels.size} etiqueta(s) enviada(s) a ${impresoras[labelPrinterIdx]}.`
        ),
      1500
    );
  };

  const selectedProducts = catalogoProductos.filter((p) => selectedLabels.has(p.id));

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-900 min-h-screen overflow-auto">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <h1 className="text-3xl font-bold tracking-wide text-gray-900 dark:text-white">Inicio</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Resumen general — Abril 2026
        </p>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* ── KPI Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            title="Ventas hoy"
            value={fmt(kpi.ventasHoy)}
            icon="💰"
            accent="text-blue-500 bg-blue-50 dark:bg-blue-900/20"
            delta="+12% vs ayer"
          />
          <KpiCard
            title="Ventas del mes"
            value={fmt(kpi.ventasMes)}
            icon="📈"
            accent="text-green-500 bg-green-50 dark:bg-green-900/20"
            delta="+8% vs mes anterior"
          />
          <KpiCard
            title="Pedidos pendientes"
            value={String(kpi.pedidosPendientes)}
            icon="📦"
            accent="text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
            delta="2 urgentes"
          />
          <KpiCard
            title="Productos en mínimo"
            value={String(kpi.productosMinimo)}
            icon="⚠️"
            accent="text-red-500 bg-red-50 dark:bg-red-900/20"
            delta="Requieren reorden"
          />
        </div>

        {/* ── Charts ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Ventas por día (últimos 7 días)
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">En pesos MXN</p>
            <div className="h-44">
              <BarChart />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Ventas mensuales (últimos 6 meses)
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">En pesos MXN</p>
            <div className="h-44">
              <LineChart />
            </div>
          </div>
        </div>

        {/* ── Top productos & Inventario crítico ────────────────────────── */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Top 5 productos más vendidos
            </h2>
            <div className="space-y-3">
              {topProductos.map((p, i) => {
                const pct = (p.unidades / topProductos[0].unidades) * 100;
                return (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600 dark:text-gray-400 truncate max-w-[220px]">
                        {p.nombre}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300 font-medium ml-2 shrink-0">
                        {p.unidades} uds
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full">
                      <div
                        className="h-2 bg-blue-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Inventario crítico
            </h2>
            <div className="space-y-3">
              {stockCritico.map((item, i) => {
                const pct = Math.round((item.stock / item.minimo) * 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                        {item.nombre}
                      </p>
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full mt-1">
                        <div
                          className="h-1.5 bg-red-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-semibold text-red-500">{item.stock}</span>
                      <span className="text-xs text-gray-400">/{item.minimo}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Impresión QR & Etiquetas ─────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-6">
          {/* QR */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Imprimir código QR de producto
            </h2>

            <div className="flex gap-4 items-start">
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-2 bg-white shrink-0">
                <FakeQR size={118} />
                <p className="text-center text-[9px] text-gray-400 mt-1 font-mono">
                  {catalogoProductos[qrProductIdx].codigo}
                </p>
              </div>

              <div className="flex-1 space-y-3 min-w-0">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Producto
                  </label>
                  <select
                    className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={qrProductIdx}
                    onChange={(e) => {
                      setQrProductIdx(Number(e.target.value));
                      setQrMsg("");
                    }}
                  >
                    {catalogoProductos.map((p, i) => (
                      <option key={p.id} value={i}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Impresora
                  </label>
                  <select
                    className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={qrPrinterIdx}
                    onChange={(e) => {
                      setQrPrinterIdx(Number(e.target.value));
                      setQrMsg("");
                    }}
                  >
                    {impresoras.map((imp, i) => (
                      <option key={i} value={i}>
                        {imp}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handlePrintQR}
                  className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-md transition-colors"
                >
                  Imprimir QR
                </button>

                {qrMsg && (
                  <p
                    className={`text-xs ${
                      qrMsg.startsWith("✓") ? "text-green-500" : "text-blue-500"
                    }`}
                  >
                    {qrMsg}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Barcode labels */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Imprimir etiquetas con código de barras
              </h2>
              <button
                onClick={() => setShowBarcodePreview(true)}
                disabled={selectedLabels.size === 0}
                className="text-xs text-blue-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed underline"
              >
                Vista previa
              </button>
            </div>

            <table className="w-full text-xs mb-3">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="pb-2 w-6">
                    <input
                      type="checkbox"
                      checked={selectedLabels.size === catalogoProductos.length}
                      onChange={toggleAllLabels}
                      className="accent-blue-500"
                    />
                  </th>
                  <th className="pb-2 text-left text-gray-500 dark:text-gray-400 font-medium">
                    Producto
                  </th>
                  <th className="pb-2 text-right text-gray-500 dark:text-gray-400 font-medium">
                    Precio
                  </th>
                </tr>
              </thead>
              <tbody>
                {catalogoProductos.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-gray-700/50">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        checked={selectedLabels.has(p.id)}
                        onChange={() => toggleLabel(p.id)}
                        className="accent-blue-500"
                      />
                    </td>
                    <td className="py-1.5 text-gray-700 dark:text-gray-300">{p.nombre}</td>
                    <td className="py-1.5 text-right text-gray-600 dark:text-gray-400">
                      {p.precio}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex gap-2 items-center">
              <select
                className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={labelPrinterIdx}
                onChange={(e) => {
                  setLabelPrinterIdx(Number(e.target.value));
                  setLabelMsg("");
                }}
              >
                {impresoras.map((imp, i) => (
                  <option key={i} value={i}>
                    {imp}
                  </option>
                ))}
              </select>
              <button
                onClick={handlePrintLabels}
                disabled={selectedLabels.size === 0}
                className="shrink-0 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-medium py-1.5 px-3 rounded-md transition-colors"
              >
                Imprimir ({selectedLabels.size})
              </button>
            </div>

            {labelMsg && (
              <p
                className={`text-xs mt-2 ${
                  labelMsg.startsWith("✓") ? "text-green-500" : "text-blue-500"
                }`}
              >
                {labelMsg}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Barcode Preview Modal ────────────────────────────────────────── */}
      {showBarcodePreview && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowBarcodePreview(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800 dark:text-white">
                Vista previa de etiquetas
              </h3>
              <button
                onClick={() => setShowBarcodePreview(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl font-bold leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {selectedProducts.map((p) => (
                <div
                  key={p.id}
                  className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-white"
                >
                  <p className="text-xs font-semibold text-gray-800 mb-0.5">{p.nombre}</p>
                  <p className="text-xs text-gray-500 mb-2">{p.precio}</p>
                  <FakeBarcode code={p.codigo} width={200} height={44} />
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                handlePrintLabels();
                setShowBarcodePreview(false);
              }}
              className="mt-4 w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium py-2 rounded-md transition-colors"
            >
              Imprimir {selectedLabels.size} etiqueta(s) — {impresoras[labelPrinterIdx]}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

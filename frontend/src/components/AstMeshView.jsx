import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Zap } from 'lucide-react';

const VIEW_WIDTH = 500;
const VIEW_HEIGHT = 360;

function positionNodes(rawNodes = []) {
  if (!rawNodes.length) return [];
  if (rawNodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))) return rawNodes;

  const nodeIds = new Set(rawNodes.map(node => node.id));
  const dependedOn = new Set(rawNodes.flatMap(node => node.deps || []));
  const roots = rawNodes.filter(node => !dependedOn.has(node.id));
  const depths = new Map((roots.length ? roots : rawNodes.slice(0, 1)).map(node => [node.id, 0]));
  const queue = [...depths.keys()];

  while (queue.length) {
    const id = queue.shift();
    const depth = depths.get(id);
    const node = rawNodes.find(item => item.id === id);
    for (const dependency of node?.deps || []) {
      if (nodeIds.has(dependency) && !depths.has(dependency)) {
        depths.set(dependency, depth + 1);
        queue.push(dependency);
      }
    }
  }

  const maxDepth = Math.max(0, ...depths.values());
  for (const node of rawNodes) {
    if (!depths.has(node.id)) depths.set(node.id, maxDepth + 1);
  }

  const layers = new Map();
  for (const node of rawNodes) {
    const depth = depths.get(node.id);
    layers.set(depth, [...(layers.get(depth) || []), node]);
  }

  const finalDepth = Math.max(...layers.keys());
  return rawNodes.map(node => {
    const depth = depths.get(node.id);
    const layer = layers.get(depth);
    const index = layer.findIndex(item => item.id === node.id);
    return {
      ...node,
      x: finalDepth === 0 ? VIEW_WIDTH / 2 : 42 + (depth / finalDepth) * (VIEW_WIDTH - 84),
      y: (VIEW_HEIGHT / (layer.length + 1)) * (index + 1),
    };
  });
}

export default function AstMeshView({ scenario, activeNode, pipelineComplete, activeRun, compact = false }) {
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const hasRunGraph = Boolean(activeRun && (activeRun.graphStatus || activeRun.nodes?.length));
  const graphStatus = hasRunGraph ? activeRun.graphStatus || 'ready' : 'idle';
  const runNodes = activeRun?.nodes;

  const nodes = useMemo(() => positionNodes(hasRunGraph ? runNodes || [] : []), [hasRunGraph, runNodes]);

  const getX = (node) => node.x;
  const getY = (node) => node.y;

  const getNodeColor = (n, idx) => {
    if (pipelineComplete && n.type === 'file') return '#34d399';
    if (n.broken || n.type === 'file' || idx === 0) return activeNode >= 2 ? '#06b6d4' : '#f87171';
    return ({
      function: '#22d3ee',
      import: '#fbbf24',
      class: '#34d399',
      variable: '#60a5fa',
    })[n.type] || '#94a3b8';
  };

  const fileLabel = activeRun?.fileName || scenario?.filename || 'No file loaded';
  const nodeCount = nodes.length;
  const inspectedNode = nodes.find(node => node.id === (selectedNode || hoveredNode));
  const emptyMessage = graphStatus === 'analyzing'
    ? activeRun?.graphMessage || 'Parsing submitted source code...'
    : graphStatus === 'idle'
    ? 'Run a patch with source code to build its AST.'
    : activeRun?.graphMessage || 'No parseable source structures were found.';

  return (
    <div className={`flex flex-col h-full ${compact ? 'gap-2' : 'gap-4 pb-8'}`}>
      {!compact && (
        <div className="shrink-0 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <Network className="w-4 h-4 text-cyan-400" />
              AST Graph Mesh
              <span className="text-[9px] font-mono text-slate-600 border border-slate-700/40 px-2 py-0.5 rounded-full">Node 02 Visualizer</span>
            </h2>
            <p className="text-[10px] font-mono text-slate-500 mt-0.5">
              {fileLabel} · {nodeCount} nodes indexed
              {graphStatus === 'ready' || graphStatus === 'partial' ? (
                <span className="ml-2 text-cyan-500/60">● Parsed from source</span>
              ) : (
                <span className="ml-2 text-slate-600">● {graphStatus === 'idle' ? 'Awaiting source' : graphStatus}</span>
              )}
            </p>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4">
            {[
              { label: 'File', color: 'bg-red-400' },
              { label: 'Function', color: 'bg-cyan-400' },
              { label: 'Import', color: 'bg-amber-400' },
              { label: 'Class / value', color: 'bg-emerald-400' },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
                <span className={`w-2 h-2 rounded-full ${l.color}`} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Main Canvas Card */}
      <div className="flex-1 bg-slate-950/80 border border-slate-800/80 rounded-xl overflow-hidden relative min-h-[220px]">
        {/* Subtle grid background */}
        <div className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="w-full h-full">
          <defs>
            <filter id="nodeGlow">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <marker id="arrowCyan" markerWidth="6" markerHeight="6" refX="20" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(6,182,212,0.8)" />
            </marker>
            <marker id="arrowGray" markerWidth="6" markerHeight="6" refX="20" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(71,85,105,0.6)" />
            </marker>
          </defs>

          {/* Edges */}
          {nodes.map((n) =>
            (n.deps || []).map((depId) => {
              const t = nodes.find((x) => x.id === depId);
              if (!t) return null;
              const active = activeNode >= 2;
              const related = !selectedNode || selectedNode === n.id || selectedNode === depId;
              return (
                <motion.line
                  key={`${n.id}-${depId}`}
                  x1={getX(n)} y1={getY(n)}
                  x2={getX(t)} y2={getY(t)}
                  stroke={selectedNode && related ? '#67e8f9' : active ? 'rgba(6,182,212,0.45)' : 'rgba(51,65,85,0.4)'}
                  strokeOpacity={related ? 1 : 0.15}
                  strokeWidth={selectedNode && related ? '2.5' : '1.5'}
                  strokeDasharray={active && !pipelineComplete ? '5 3' : undefined}
                  markerEnd={active ? 'url(#arrowCyan)' : 'url(#arrowGray)'}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              );
            })
          )}

          {/* Nodes */}
          {nodes.map((n, idx) => {
            const color = getNodeColor(n, idx);
            const cx = getX(n);
            const cy = getY(n);
            const isTarget = n.type === 'file' || n.broken || idx === 0;
            const label = n.label || n.id || '';
            const displayLabel = label.length > 12 ? `${label.slice(0, 11)}…` : label;
            const isSelected = selectedNode === n.id;

            return (
              <g
                key={n.id || idx}
                role="button"
                tabIndex={0}
                aria-label={`${n.type || 'AST node'}: ${label}`}
                aria-pressed={isSelected}
                onMouseEnter={() => setHoveredNode(n.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onFocus={() => setHoveredNode(n.id)}
                onBlur={() => setHoveredNode(null)}
                onClick={() => setSelectedNode(current => current === n.id ? null : n.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedNode(current => current === n.id ? null : n.id);
                  }
                }}
                className="cursor-pointer outline-none"
              >
                {/* Pulse ring on broken/target node */}
                {isTarget && !pipelineComplete && (
                  <circle cx={cx} cy={cy} r="30" fill="none" stroke={color} strokeWidth="1" className="animate-ping opacity-20" />
                )}

                {/* Node circle */}
                <motion.circle
                  cx={cx} cy={cy} r="22"
                  fill="#030712"
                  stroke={color}
                  strokeWidth={isTarget ? 2 : 1.5}
                  filter="url(#nodeGlow)"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: idx * 0.08, duration: 0.3 }}
                />

                {/* Node label */}
                <text
                  x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="central"
                  fill={color} fontSize="7.5" fontFamily="monospace" fontWeight="600"
                >
                  {displayLabel}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        <AnimatePresence>
          {inspectedNode && (
              <motion.div
                key={inspectedNode.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute top-2 right-2 max-w-[210px] bg-slate-900/95 border border-slate-700 p-2.5 rounded-lg text-[9px] font-mono text-slate-200 z-10 shadow-2xl"
              >
                <div className="font-bold text-[10px] text-slate-100 mb-1 break-all">{inspectedNode.label || inspectedNode.id}</div>
                <div className="text-cyan-300">{inspectedNode.type || 'AST node'}{inspectedNode.line ? ` · line ${inspectedNode.line}` : ''}</div>
                <div className="text-slate-400 mt-1">{inspectedNode.detail}</div>
                <div className="text-slate-300 mt-1">Depends on: {(inspectedNode.deps || []).map(id => nodes.find(node => node.id === id)?.label || id).join(', ') || 'none'}</div>
                <div className="text-slate-500 mt-1">Used by: {nodes.filter(node => node.deps?.includes(inspectedNode.id)).map(node => node.label || node.id).join(', ') || 'none'}</div>
              </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 grid place-content-center px-5 text-center text-[10px] font-mono text-slate-500">
            <span className="flex items-center justify-center gap-2"><Zap className="w-3 h-3 text-cyan-500" />{emptyMessage}</span>
          </div>
        )}
        {graphStatus === 'partial' && activeRun?.graphMessage && nodes.length > 0 && (
          <div className="absolute bottom-2 left-2 text-[9px] font-mono text-amber-400">{activeRun.graphMessage}</div>
        )}
      </div>
    </div>
  );
}
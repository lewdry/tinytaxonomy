<script lang="ts">
	import * as d3 from 'd3';

	export let data: any;
// layout: 'tree' or 'radial'
export let layout: 'tree' | 'radial' = 'tree';
// only show nodes up to this depth (0 = root only). Set high default to show everything.
export let maxDepth: number = Infinity;

	let svgElement: SVGSVGElement;
	let containerDiv: HTMLDivElement;
	
    // Set initial dimensions
    let width = 900;
	let height = 600;

	// Collapsed node id set (for hierarchical folding)
	let collapsed = new Set<number>();

	// Use a reactive block to recalculate and re-render the tree when data changes
	$: if (data && svgElement) {
        // Re-read width/height from container for responsiveness
        width = containerDiv.clientWidth;
        height = containerDiv.clientHeight;
		renderTree(data);
	}

	function renderTree(hierarchyData: any) {
		const svg = d3.select(svgElement);
		svg.selectAll('*').remove(); // Clear previous rendering

		// create a deep-cloned copy of the hierarchy so we can prune collapsed nodes and limit depth
		let workingData: any;
		try {
			workingData = JSON.parse(JSON.stringify(hierarchyData));
		} catch (err) {
			// fallback to original if clone fails
			workingData = hierarchyData;
		}

		function prune(node: any, depth = 0, parent: any = null, index: number = -1) {
			if (!node) return;
			if (!node.children) return;
			// if this node has an id and it's collapsed, remove children
			if (node.id && collapsed.has(node.id)) {
				node._children = node.children;
				node.children = null;
				return;
			}
			if (typeof maxDepth === 'number' && depth >= maxDepth) {
				// hide children beyond max depth
				node._children = node.children;
				node.children = null;
				return;
			}
			// Prune children recursively
			if (Array.isArray(node.children)) {
				for (let i = node.children.length - 1; i >= 0; i--) {
					prune(node.children[i], depth + 1, node, i);
				}
				// After recursion, filter out all empty clusters from children
				node.children = node.children.filter((child: any) => {
					const isCluster = child.type === 'cluster' || child.clusterLabel || child.label === 'cluster';
					return !(isCluster && (!child.children || child.children.length === 0));
				});
				// If children array is now empty, set to null for consistency
				if (node.children.length === 0) node.children = null;
			}
		}

		prune(workingData);

		const root = d3.hierarchy(workingData);
        
        // Dynamic height adjustment based on number of leaves for better vertical spacing
		const leaves = root.leaves().length;
		const dynamicHeight = Math.max(height, leaves * 25);

		// Define the tree layout
		// layout: either standard left-right tree, or radial cluster
		if (layout === 'tree') {
			const treeLayout = d3.tree().size([dynamicHeight, width - 200]);
			treeLayout(root);
		} else {
			// radial cluster layout: angle -> x, radius -> y
			const radius = Math.min(width, dynamicHeight) / 2 - 40;
			const cluster = d3.cluster().size([2 * Math.PI, radius]);
			cluster(root);
			// convert polar coordinates to cartesian for layout
			root.each((d: any) => {
				const angle = d.x;
				const r = d.y;
				d.x = r * Math.sin(angle - Math.PI / 2);
				d.y = r * Math.cos(angle - Math.PI / 2);
			});
		}

		// Container group for the tree, offset to the right (or centered for radial)
		const g = svg.append('g').attr('transform', layout === 'tree' ? 'translate(100,0)' : `translate(${width/2},${dynamicHeight/2})`);

		// Compute color scale for cluster height if available
		const internalNodes = root.descendants().filter((d: any) => d.children && Array.isArray(d.children));
		const heights = internalNodes.map((d: any) => d.data?.height).filter((h: any) => typeof h === 'number');
		const heightMin = heights.length ? Math.min(...heights) : 0;
		const heightMax = heights.length ? Math.max(...heights) : 1;
		const heightColorScale = heights.length
			? d3.scaleLinear<string>().domain([heightMin, heightMax]).range(['#fee5d9', '#a50f15'])
			: null;

		// For consistent branch coloring, map top-level branches to a categorical color scale
		const topLevelChildren = root.children ?? [];
		const normalizeKey = (raw: any) => {
			if (!raw) return 'root';
			const s = String(raw);
			// prefer first slash-separated token and strip trailing bracket hints
			const base = s.split('/')[0].trim().replace(/\s*\(.*?\)\s*/g, '').trim();
			return base.length ? base : s;
		};

		const branchKeys = topLevelChildren.map((c: any) => normalizeKey(c.data?.clusterLabel ?? c.data?.name ?? String(c.data?.id ?? Math.random())));
		const branchColor = d3.scaleOrdinal<string>(d3.schemeTableau10).domain(branchKeys);

		// Links (Paths between nodes)
		const linkSel = g.selectAll('.link')
			.data(root.links())
			.enter()
			.append('path')
			.attr('class', 'link fill-none stroke-gray-300 stroke-[1.5px] opacity-70')
			// color links by the nearest top-level branch color (visually groups branches)
			.attr('stroke', (d: any) => {
				// pick top-level ancestor key
				const anc = d.source.ancestors().reverse().find((a: any) => a.depth === 1) ?? d.source;
				const key = normalizeKey(anc?.data?.clusterLabel ?? anc?.data?.name ?? String(anc?.data?.id ?? 'root'));
				// store branch key on the element for easier selection
				// @ts-ignore - d3 selection attribute
				d.__branchKey = key;
				return branchColor(key) ?? '#d1d5db';
			})
			.attr('data-branch-key', (d: any) => (d.source && d.source.ancestors ? normalizeKey((d.source.ancestors().reverse().find((a: any) => a.depth === 1) ?? d.source).data?.clusterLabel ?? (d.source.data?.name ?? String(d.source.data?.id ?? 'root'))) : ''))
			.attr('stroke-width', (d: any) => {
				const parent = d.source?.data;
				if (parent && parent.height != null && typeof heightMin === 'number' && typeof heightMax === 'number') {
					const norm = (parent.height - heightMin) / Math.max(1e-6, heightMax - heightMin);
					return Math.max(1, 1 + Math.round(norm * 3));
				}
				return 1.5;
			})
			.attr('d', d3.linkHorizontal()
				.x((d: any) => d.y)
				.y((d: any) => d.x) as any
            );

        // Nodes (Container for Circle and Text)
		const node = g.selectAll('.node')
			.data(root.descendants())
			.enter()
			.append('g')
			.attr('class', (d) => 'node' + (d.children ? ' node--internal' : ' node--leaf'))
			.attr('transform', (d: any) => `translate(${d.y},${d.x})`)
			// attach the top-level branch key to the node DOM so we can match quickly
			.attr('data-branch-key', (d: any) => {
				const anc = d.ancestors().reverse().find((a: any) => a.depth === 1) ?? d;
				return normalizeKey(anc?.data?.clusterLabel ?? anc?.data?.name ?? String(anc?.data?.id ?? 'root'));
			})
			.attr('data-node-id', (d: any) => d.data?.id ?? '');

		// Draw shapes: diamonds for clusters (internal nodes) and small circles for leaves
		node.each(function(d: any) {
			const g = d3.select(this);
			if (d.children) {
				// diamond path for cluster node
				const diamond = 'M 0 -6 L 6 0 L 0 6 L -6 0 Z';
				g.append('path')
					.attr('d', diamond)
					.attr('class', 'cursor-default')
					.attr('fill', () => {
						// color by branch key for consistency
						const anc = d.ancestors().reverse().find((a: any) => a.depth === 1) ?? d;
						const key = normalizeKey(anc?.data?.clusterLabel ?? anc?.data?.name ?? String(anc?.data?.id ?? 'root'));
						return branchColor(key);
					})
					.attr('stroke', '#1f2937')
					.attr('stroke-width', 0.4)
					.on('dblclick', (evt: any) => {
						// Toggle collapse on double-click
						if (d.data && d.data.id) {
							if (collapsed.has(d.data.id)) collapsed.delete(d.data.id); else collapsed.add(d.data.id);
							// re-render with new collapsed states
							renderTree(hierarchyData);
						}
					})
					// highlight on hover
					.on('mouseover', () => {
						const rawKey = (d.ancestors().reverse().find((a: any) => a.depth === 1) ?? d).data?.clusterLabel ?? (d.data?.name ?? String(d.data?.id ?? 'root'));
						const key = normalizeKey(rawKey);
						// dim everything then highlight matches using normalized keys
						node.style('opacity', (n: any) => {
							const nraw = (n.ancestors().reverse().find((a: any) => a.depth === 1) ?? n).data?.clusterLabel ?? (n.data?.name ?? String(n.data?.id ?? 'root'));
							const nkey = normalizeKey(nraw);
							return nkey === key ? 1 : 0.2;
						});
						linkSel.style('opacity', (ln: any) => {
							const lraw = ln.source && ln.source.ancestors ? (ln.source.ancestors().reverse().find((a: any) => a.depth === 1) ?? ln.source).data?.clusterLabel ?? (ln.source.data?.name ?? String(ln.source.data?.id ?? 'root')) : '';
							const lkey = normalizeKey(lraw);
							return lkey === key ? 1 : 0.12;
						});
					})
					.on('mouseout', () => {
						// restore defaults
						node.style('opacity', 1);
						linkSel.style('opacity', 0.7);
					})
			} else {
				g.append('circle')
					.attr('r', 4)
					.attr('class', 'cursor-pointer')
					.attr('fill', () => {
						// leaves get branch color too to keep consistent mapping
						const anc = d.ancestors().reverse().find((a: any) => a.depth === 1) ?? d;
						const key = normalizeKey(anc?.data?.clusterLabel ?? anc?.data?.name ?? String(anc?.data?.id ?? 'root'));
						return branchColor(key);
					})
					.on('click', (evt: any) => {
						// optional single-click behavior for leaf nodes (e.g., select)
					});
			}
		});

		// Node Labels (Text) — internal nodes show clusterLabel (if present) + H value
		node.append('text')
			.attr('dy', 3)
			.attr('x', (d) => d.children ? -12 : 10)
			.style('text-anchor', (d) => d.children ? 'end' : 'start')
			.attr('class', 'text-xs font-semibold fill-gray-700')
			.text((d: any) => {
				if (d.children) {
					// prefer a short label computed by the worker
					const cl = d.data?.clusterLabel ?? d.data?.clusterKeywords?.join(' / ') ?? d.data.name;
					const H = typeof d.data?.height === 'number' ? ` • H:${d.data.height.toFixed(2)}` : '';
					return `${cl}${H}`;
				}
				return d.data.name;
			})
			// Tooltip on hover showing a clean, helpful cluster summary
			.append('title')
			.text((d: any) => {
				// For leaves: show the full text
				if (!d.children) return d.data.fullText || d.data.name || 'leaf';

				// For clusters: show precise size and sample members
				const size = d.leaves().length;
				const sample = d.data?.sampleLeaves ?? d.leaves().map((l: any) => l.data?.fullText ?? l.data?.name ?? '').slice(0, 5);
				const sampleText = (sample && sample.length) ? sample.map((s: string) => s.length > 120 ? s.substring(0, 120) + '...' : s).join('\n- ') : 'no preview available';

				const height = d.data?.height ?? 'N/A';
				const keywords = (d.data?.clusterKeywords && d.data.clusterKeywords.length) ? `Keywords: ${d.data.clusterKeywords.join(', ')}` : '';
				const label = d.data?.clusterLabel ? `Label: ${d.data.clusterLabel}` : '';
				const header = `Cluster (${size} items) • H: ${typeof height === 'number' ? height.toFixed(2) : height}`;
				return header + (label ? '\n' + label : '') + (sampleText ? '\n\nTop members:\n- ' + sampleText : '');
			});

		// Add a background bar and a width-encoded severity bar under internal node labels
		// Width = normalized merge distance (larger distance -> weaker relationship)
		const maxBarWidth = 64;
		node.filter((d: any) => d.children && d.data && typeof d.data.height === 'number')
			.append('rect')
			.attr('x', (d: any) => d.children ? -Math.round(maxBarWidth/2) : 8)
			.attr('y', 12)
			.attr('width', maxBarWidth)
			.attr('height', 6)
			.attr('rx', 3)
			.attr('class', 'fill-gray-200')
			.append('title')
			.text((d: any) => `Merge distance: ${d.data.height}`);

		// overlay bar to indicate merge distance severity using width (color encodes semantic family)
		node.filter((d: any) => d.children && d.data && typeof d.data.height === 'number')
			.append('rect')
			.attr('x', (d: any) => d.children ? -Math.round(maxBarWidth/2) : 8)
			.attr('y', 12)
			.attr('width', (d: any) => {
				const h = d.data.height ?? 0;
				if (typeof heightMin !== 'number' || typeof heightMax !== 'number') return 0;
				// normalize to 0..1
				const norm = (h - heightMin) / Math.max(1e-6, heightMax - heightMin);
				// width increases with distance (distance ↑ = weaker relationship)
				return Math.round(maxBarWidth * norm);
			})
			.attr('height', 6)
			.attr('rx', 3)
			.attr('fill', (d: any) => {
				// use semantic (branch) color to encode category/topic (not distance)
				const anc = d.ancestors().reverse().find((a: any) => a.depth === 1) ?? d;
				const key = normalizeKey(anc?.data?.clusterLabel ?? anc?.data?.name ?? String(anc?.data?.id ?? 'root'));
				return branchColor(key);
			});


		// Add an improved legend showing color mapping, shape meaning and help text
		// We compute the bbox of the content and draw a background rect sized to fit (prevents overflow)
		const legendPadding = 10;
		const legendX = 20; // bottom-left
		const legendY = Math.max(40, height - 140);
		const legend = svg.append('g').attr('class', 'taxonomy-legend').attr('transform', `translate(${legendX}, ${legendY})`);

		// group containing content — we'll measure this group's bbox and add a background rect to fit
		const content = legend.append('g').attr('class', 'legend-content');
		content.append('text').attr('x', 10).attr('y', 16).attr('class', 'text-xs fill-gray-500').text('Legend:');

		// color swatches for top-level branches (keep at most 6 to avoid overflowing the legend)
		const visibleBranches = branchKeys.slice(0, 6);
		const swatchWidth = 120;
		// attempt to compute per-row based on a reasonable max width — but avoid magic numbers by allowing fit
		const perRow = Math.max(1, Math.min(visibleBranches.length, Math.floor(420 / swatchWidth)));
		const rows = Math.ceil(visibleBranches.length / perRow);
		const swatchStartX = 10;
		const swatchStartY = 34;

		if (visibleBranches.length) {
			visibleBranches.forEach((key: any, i: number) => {
				const row = Math.floor(i / perRow);
				const col = i % perRow;
				const x = swatchStartX + col * (swatchWidth - 12);
				const y = swatchStartY + row * 22;

				const sw = legend.append('rect')
					.attr('x', x)
					.attr('y', y - 8)
					.attr('width', 12)
					.attr('height', 12)
					.attr('rx', 2)
					.attr('fill', branchColor(key))
					.style('cursor', 'pointer');

				const label = content.append('text').attr('x', x + 18).attr('y', y + 2).attr('class', 'text-xs fill-gray-400').text(key.length > 22 ? key.substring(0, 20) + '…' : key).style('cursor', 'pointer');

				// hover to highlight entire branch; click toggles collapse on top-level branch node
				const onOver = () => {
					node.style('opacity', (n: any) => {
						const nraw = (n.ancestors().reverse().find((a: any) => a.depth === 1) ?? n).data?.clusterLabel ?? (n.data?.name ?? String(n.data?.id ?? 'root'));
						const nkey = normalizeKey(nraw);
						return nkey === key ? 1 : 0.2;
					});
					linkSel.style('opacity', (ln: any) => {
						const lraw = ln.source && ln.source.ancestors ? (ln.source.ancestors().reverse().find((a: any) => a.depth === 1) ?? ln.source).data?.clusterLabel ?? (ln.source.data?.name ?? String(ln.source.data?.id ?? 'root')) : '';
						const lkey = normalizeKey(lraw);
						return lkey === key ? 1 : 0.12;
					});
				};

				const onOut = () => {
					node.style('opacity', 1);
					linkSel.style('opacity', 0.7);
				};

				sw.on('mouseover', onOver).on('mouseout', onOut).on('click', () => {
					node.style('opacity', (n: any) => {
						const nraw = (n.ancestors().reverse().find((a: any) => a.depth === 1) ?? n).data?.clusterLabel ?? (n.data?.name ?? String(n.data?.id ?? 'root'));
						const nkey = normalizeKey(nraw);
						return nkey === key ? 1 : 0.2;
					});
					linkSel.style('opacity', (ln: any) => {
						const lraw = ln.source && ln.source.ancestors ? (ln.source.ancestors().reverse().find((a: any) => a.depth === 1) ?? ln.source).data?.clusterLabel ?? (ln.source.data?.name ?? String(ln.source.data?.id ?? 'root')) : '';
						const lkey = normalizeKey(lraw);
						return lkey === key ? 1 : 0.12;
					});
				}).on('mouseout', onOut);

				label.on('mouseover', onOver).on('mouseout', onOut).on('click', () => {
					const m = topLevelChildren.find((c: any) => normalizeKey(c.data?.clusterLabel ?? c.data?.name ?? String(c.data?.id ?? 'root')) === key);
					if (m && m.data && m.data.id) {
						if (collapsed.has(m.data.id)) collapsed.delete(m.data.id); else collapsed.add(m.data.id);
						renderTree(hierarchyData);
					}
				});
			});

			const infoY = swatchStartY + rows * 24 + 8;
			let legendLineY = infoY + 16;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Leaf = original item (circle)');
			legendLineY += 24;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Color = semantic topic family (branches share a color)');
			legendLineY += 24;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Cluster = merged group (diamond); label = learned concept (TextRank); tooltip shows examples');
			legendLineY += 24;
			// Explain the meaning and mapping: bar width indicates distance and bigger distance = weaker relationship
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Bar width = merge distance (H); distance ↑ = weaker relationship');
			legendLineY += 24;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Double-click a diamond to collapse/expand that branch');
		} else {
			// fallback mono legend — draw same explanatory text into content group with more spacing
			let legendLineY = 36;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Leaf = original item (circle)');
			legendLineY += 24;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Color = semantic topic family (branches share a color)');
			legendLineY += 24;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Cluster = merged group (diamond); label = learned concept (TextRank); tooltip shows examples');
			legendLineY += 24;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Bar width = merge distance (H); distance ↑ = weaker relationship');
			legendLineY += 24;
			content.append('text').attr('x', 10).attr('y', legendLineY).attr('class', 'text-xs fill-gray-400').text('• Double-click a diamond to collapse/expand that branch');
		}

		// measure content and add a background rect sized to the content to avoid overflowing
		try {
			// sometimes getBBox can throw on hidden elements — guard with try/catch
			const bbox = (content.node() as any).getBBox();
			const bgX = bbox.x - legendPadding;
			const bgY = bbox.y - legendPadding;
			const bgW = Math.max(240, bbox.width + legendPadding * 2);
			const bgH = Math.max(200, bbox.height + legendPadding * 2); // increase min height
			// insert the background rect under the content
			legend.insert('rect', ':first-child')
				.attr('x', bgX)
				.attr('y', bgY)
				.attr('width', bgW)
				.attr('height', bgH)
				.attr('rx', 8)
				.attr('class', 'fill-white stroke-gray-200')
				.style('cursor', 'move');
			// clamp legend position if needed
		} catch (err) {
			// in worst case fallback to drawing a fixed background
			legend.insert('rect', ':first-child')
				.attr('x', -legendPadding)
				.attr('y', -legendPadding)
				.attr('width', 420)
				.attr('height', 200)
				.attr('rx', 8)
				.attr('class', 'fill-white stroke-gray-200')
				.style('cursor', 'move');
		}

		// make legend draggable so it doesn't permanently block the view
		try {
			// d3.drag has some typing differences in the workspace — cast to any for safety
			legend.call((d3.drag() as any).on('start', function(this: any) { this.parentNode?.appendChild(this); })
				.on('drag', (event: any) => {
					// clamp so legend stays roughly within view
					const nx = Math.max(6, Math.min(event.x, width - 60));
					const ny = Math.max(6, Math.min(event.y, height - 30));
					legend.attr('transform', `translate(${nx}, ${ny})`);
				})
			);
		} catch (err) {
			// drag behaviour is optional — ignore if D3 drag throws
		}

        // Add Zoom/Pan Behavior
        const zoom = d3.zoom()
            .scaleExtent([0.5, 5]) // Limit zoom levels
            .on('zoom', (e) => {
                g.attr('transform', e.transform);
            });
        
        // Apply zoom to the SVG element
        svg.call(zoom as any);
	}
</script>

<div bind:this={containerDiv} class="w-full h-full border bg-white rounded-lg overflow-hidden relative">
    <svg 
        bind:this={svgElement} 
        width={width} 
        height={height} 
        class="w-full h-full cursor-move bg-slate-50"
    ></svg>
	<div class="absolute top-4 right-4 text-xs text-gray-400 pointer-events-none bg-white/60 rounded px-2 py-1">
		Scroll to Zoom • Drag to Pan
	</div>
</div>
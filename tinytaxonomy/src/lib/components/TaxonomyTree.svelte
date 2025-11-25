<script lang="ts">
	import * as d3 from 'd3';

	export let data: any;

	let svgElement: SVGSVGElement;
	let containerDiv: HTMLDivElement;
	
    // Set initial dimensions
    let width = 900;
	let height = 600;

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

		const root = d3.hierarchy(hierarchyData);
        
        // Dynamic height adjustment based on number of leaves for better vertical spacing
		const leaves = root.leaves().length;
		const dynamicHeight = Math.max(height, leaves * 25);

		// Define the tree layout
		const treeLayout = d3.tree().size([dynamicHeight, width - 200]); 
		treeLayout(root);

        // Container group for the tree, offset to the right
		const g = svg.append('g').attr('transform', 'translate(100,0)');

		// Compute color scale for cluster height if available
		const internalNodes = root.descendants().filter((d: any) => d.children && Array.isArray(d.children));
		const heights = internalNodes.map((d: any) => d.data?.height).filter((h: any) => typeof h === 'number');
		const heightMin = heights.length ? Math.min(...heights) : 0;
		const heightMax = heights.length ? Math.max(...heights) : 1;
		const colorScale = heights.length
			? d3.scaleLinear<string>().domain([heightMin, heightMax]).range(['#fee5d9', '#a50f15'])
			: null;

		// Links (Paths between nodes)
		g.selectAll('.link')
			.data(root.links())
			.enter()
			.append('path')
			.attr('class', 'link fill-none stroke-gray-300 stroke-[1.5px] opacity-70')
			// color links by the parent node's height when available
			.attr('stroke', (d: any) => {
				const parent = d.source?.data;
				if (parent && parent.height != null && colorScale) return colorScale(parent.height as number);
				return '#d1d5db'; // default gray-300
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
			.attr('transform', (d: any) => `translate(${d.y},${d.x})`);

		// Node Circles
		node.append('circle')
			.attr('r', (d) => d.children ? 6 : 4) // Internal nodes slightly bigger
			.attr('class', (d) => d.children ? 'hover:fill-gray-700 cursor-default' : 'cursor-pointer')
			.attr('fill', (d: any) => {
				// Leaves remain blue; internal nodes get color by height
				if (!d.children) return '#2563eb'; // blue-600
				if (d.data && typeof d.data.height === 'number' && colorScale) return colorScale(d.data.height);
				return '#6b7280'; // gray-500 fallback
			});

		// Node Labels (Text)
		node.append('text')
			.attr('dy', 3)
			.attr('x', (d) => d.children ? -8 : 8)
			.style('text-anchor', (d) => d.children ? 'end' : 'start')
			.text((d: any) => d.data.name)
            .attr('class', 'text-xs font-mono fill-gray-700')
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
				const header = `Cluster (${size} items) • H: ${typeof height === 'number' ? height.toFixed(2) : height}`;
				return header + (sampleText ? '\n\nTop members:\n- ' + sampleText : '');
			});

		// Add a small legend showing color mapping and help text
		const legendPadding = 10;
		const legend = svg.append('g').attr('class', 'taxonomy-legend').attr('transform', `translate(${20}, ${height - 80})`);

		// Background
		legend.append('rect').attr('x', -legendPadding).attr('y', -legendPadding).attr('width', 300).attr('height', 70).attr('rx', 8).attr('class', 'fill-white stroke-gray-200');

		// Legend content
		legend.append('text').attr('x', 10).attr('y', 8).attr('class', 'text-xs fill-gray-500').text('Legend:');
		legend.append('text').attr('x', 10).attr('y', 24).attr('class', 'text-xs fill-gray-400').text('• Leaf = original item (sentence/word)');
		legend.append('text').attr('x', 10).attr('y', 40).attr('class', 'text-xs fill-gray-400').text('• Cluster = merged group; tooltip shows size & sample members');
		legend.append('text').attr('x', 10).attr('y', 56).attr('class', 'text-xs fill-gray-400').text('• Color (darker) indicates larger merge distance (H)');

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
    <div class="absolute bottom-4 right-4 text-xs text-gray-400 pointer-events-none">
        Scroll to Zoom • Drag to Pan
    </div>
</div>
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

        // Links (Paths between nodes)
		g.selectAll('.link')
			.data(root.links())
			.enter()
			.append('path')
			.attr('class', 'link fill-none stroke-gray-300 stroke-[1.5px] opacity-70')
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
			.attr('r', (d) => d.children ? 5 : 4) // Internal nodes slightly bigger
			.attr('class', (d) => d.children ? 'fill-gray-500 hover:fill-gray-700' : 'fill-blue-600 hover:fill-blue-700 cursor-pointer');

		// Node Labels (Text)
		node.append('text')
			.attr('dy', 3)
			.attr('x', (d) => d.children ? -8 : 8)
			.style('text-anchor', (d) => d.children ? 'end' : 'start')
			.text((d: any) => d.data.name)
            .attr('class', 'text-xs font-mono fill-gray-700')
            // Tooltip on hover showing the full text
            .append('title')
            .text((d: any) => d.data.fullText || `Cluster (${d.descendants().length - 1} items)`);

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
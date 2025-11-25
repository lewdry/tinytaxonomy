<script lang="ts">
import { onMount } from 'svelte';
import cloud from 'd3-cloud';
import * as d3 from 'd3';

export let words: {text: string, size: number}[] = [];

let svgEl: SVGSVGElement;

onMount(() => {
    if (!words.length) return;
    const layout = cloud()
        .size([400, 300])
        .words(words.map(d => ({...d})))
        .padding(5)
        .rotate(() => ~~(Math.random() * 2) * 90)
        .font('Impact')
        .fontSize((d: {text: string, size: number}) => d.size)
        .on('end', draw);
    layout.start();

    function draw(words: any[]) {
        const svg = d3.select(svgEl)
            .attr('width', 400)
            .attr('height', 300)
            .attr('viewBox', '0 0 400 300');
        svg.selectAll('*').remove();
        svg.append('g')
            .attr('transform', 'translate(200,150)')
            .selectAll('text')
            .data(words)
            .enter().append('text')
            .style('font-family', 'Impact')
            .style('font-size', d => d.size + 'px')
            .style('fill', () => d3.schemeCategory10[Math.floor(Math.random() * 10)])
            .attr('text-anchor', 'middle')
            .attr('transform', d => `translate(${d.x},${d.y})rotate(${d.rotate})`)
            .text(d => d.text);
    }
});
</script>

<svg bind:this={svgEl}></svg>

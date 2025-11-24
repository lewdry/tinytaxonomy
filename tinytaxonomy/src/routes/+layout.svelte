<script>
    import "../app.css";
    import favicon from '$lib/assets/favicon.svg';
</script>

<svelte:head>
    <link rel="icon" href="{favicon}" />
</svelte:head>

<!-- This is the Svelte 4/SvelteKit 2 way to render nested content -->
<slot />
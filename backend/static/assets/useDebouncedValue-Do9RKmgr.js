import{r as o}from"./vendor-CI3ruxnr.js";function n(e,t=300){const[r,u]=o.useState(e);return o.useEffect(()=>{const s=setTimeout(()=>u(e),t);return()=>clearTimeout(s)},[e,t]),r}export{n as u};

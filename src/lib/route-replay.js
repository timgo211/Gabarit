// Cadrage d'un itinéraire montré avant la création de la carte (v85). Exemple : itinéraire repris par la mémoire v53
// alors que le style de la carte se charge encore (loadStyle → build de src/ui/map.js, asynchrone).
// Tracés et repères sont déjà rejoués par build() (couches sur « style.load », repères depuis `marks`) ; ce module
// retient seulement si le cadrage demandé reste à faire, pour qu'il soit fait une fois, à la création de la carte.

/** @returns {{ deferred:(fit:boolean)=>void, shown:()=>void, takeFit:()=>boolean, pending:()=>boolean }} */
export function createRouteReplay() {
  let pendingFit = false;
  return {
    /** showRoutes sans carte : le dernier appel décide (fit: false = ne pas cadrer). */
    deferred(fit) { pendingFit = fit === true; },
    /** showRoutes avec carte (cadré tout de suite) ou liste vide : plus rien en attente. */
    shown() { pendingFit = false; },
    /** À la création de la carte : vrai une seule fois s'il faut cadrer (aucun second cadrage, ex. contexte WebGL recréé). */
    takeFit() { const f = pendingFit; pendingFit = false; return f; },
    pending: () => pendingFit,
  };
}

"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  actionClavierArbre,
  aplatirArbre,
  appliquerRepli,
  elementFocalisable,
  type NoeudNavigable,
} from "../../lib/arbre-clavier";
import {
  hrefHypothese,
  etatVerdict,
  lectureMinimale,
  libelleRaisonVerdict,
  VERDICT_DD_LIBELLES,
  type NoeudArbre,
} from "../../lib/due-diligence";
import { BadgeStatut } from "../ui/BadgeStatut";
import { BadgeLecture, BadgeVerdict } from "./BadgesDd";

export interface ArbreHypothesesProps {
  missionId: string;
  dossierId: string;
  arbre: NoeudArbre[];
  /** Hypothèse sélectionnée (page de détail), le cas échéant : `aria-selected` n'est posé que si elle est fournie. */
  selectionId?: string;
}

interface ContexteArbre {
  missionId: string;
  dossierId: string;
  prefixe: string;
  replies: ReadonlySet<string>;
  focalisable: string | null;
  selectionId?: string;
}

const versNavigable = (n: NoeudArbre): NoeudNavigable => ({
  id: n.noeud.id,
  enfants: n.enfants.map(versNavigable),
});

function Noeud({ n, c }: { n: NoeudArbre; c: ContexteArbre }) {
  const { noeud } = n;
  const etat = etatVerdict(noeud);
  const nbLiens = noeud.liens.length;
  const aEnfants = n.enfants.length > 0;
  const deplie = aEnfants && !c.replies.has(noeud.id);
  const idMeta = `${c.prefixe}-meta-${noeud.id}`;
  const idConflit = `${c.prefixe}-conflit-${noeud.id}`;
  return (
    // Le <li> est neutre : le nœud ARIA est le lien (élément focalisable), les badges le décrivent.
    <li role="none">
      <div className="mp-arbre-dd__noeud">
        <span className="mp-arbre-dd__titre">
          <Link
            href={hrefHypothese(c.missionId, c.dossierId, noeud.id)}
            role="treeitem"
            aria-level={n.profondeur}
            aria-expanded={aEnfants ? deplie : undefined}
            aria-selected={c.selectionId === undefined ? undefined : c.selectionId === noeud.id}
            aria-describedby={noeud.indication.conflit ? `${idMeta} ${idConflit}` : idMeta}
            tabIndex={c.focalisable === noeud.id ? 0 : -1}
            data-noeud-id={noeud.id}
          >
            {noeud.libelle}
          </Link>
        </span>
        <span className="mp-dd-meta" id={idMeta}>
          <BadgeVerdict etat={etat} />
          <BadgeStatut tonalite="neutre" sansIcone>
            {`Indication du moteur : ${VERDICT_DD_LIBELLES[noeud.indication.indication].toLowerCase()}`}
          </BadgeStatut>
          <BadgeLecture lecture={lectureMinimale(noeud.liens)} />
          <span className="mp-texte-doux mp-texte-petit">
            {nbLiens === 0
              ? "Aucune assertion liée"
              : nbLiens === 1
                ? "1 assertion liée"
                : `${nbLiens} assertions liées`}
          </span>
        </span>
        {noeud.indication.conflit ? (
          <p className="mp-texte-petit" id={idConflit}>
            {libelleRaisonVerdict("CONFLIT_SOLIDE")}
          </p>
        ) : null}
      </div>
      {deplie ? (
        <ul role="group" aria-label={`Sous-hypothèses de ${noeud.libelle}`}>
          {n.enfants.map((e) => (
            <Noeud key={e.noeud.id} n={e} c={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Arbre d'hypothèses (DD-09, profondeur 4 au plus) : arbre ARIA (`tree`, `treeitem`, `group`),
 * chaque nœud avec son état (confirmée, infirmée, non concluante, en attente, ouverte), l'indication
 * du moteur et la plus faible solidité de ses sources. Les données sont déjà calculées par l'API ;
 * le composant ne garde que l'état de repli et le focus (une seule tabulation, puis les flèches :
 * haut/bas, droite/gauche pour déplier/replier ou changer de niveau, Début, Fin).
 */
export function ArbreHypotheses({
  missionId,
  dossierId,
  arbre,
  selectionId,
}: ArbreHypothesesProps) {
  const prefixe = useId();
  const racine = useRef<HTMLUListElement>(null);
  const [replies, setReplies] = useState<ReadonlySet<string>>(new Set());
  const [courant, setCourant] = useState<string | null>(null);
  const navigable = useMemo(() => arbre.map(versNavigable), [arbre]);
  const visibles = useMemo(() => aplatirArbre(navigable, replies), [navigable, replies]);
  const focalisable = elementFocalisable(visibles, courant);

  function surTouche(e: KeyboardEvent<HTMLUListElement>) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const cible = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const id = cible?.dataset.noeudId;
    if (!id) return;
    const action = actionClavierArbre(visibles, id, e.key);
    if (!action) return;
    e.preventDefault();
    if (action.type === "focus") {
      setCourant(action.id);
      racine.current?.querySelector<HTMLElement>(`[data-noeud-id="${action.id}"]`)?.focus();
    } else {
      setReplies((r) => appliquerRepli(r, action));
    }
  }

  return (
    <ul
      ref={racine}
      className="mp-arbre-dd"
      role="tree"
      aria-label="Arbre des hypothèses"
      onKeyDown={surTouche}
      onFocus={(e) => {
        const id = (e.target as HTMLElement).dataset?.noeudId;
        if (id) setCourant(id);
      }}
    >
      {arbre.map((n) => (
        <Noeud
          key={n.noeud.id}
          n={n}
          c={{ missionId, dossierId, prefixe, replies, focalisable, selectionId }}
        />
      ))}
    </ul>
  );
}

import Link from "next/link";
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
}

function Noeud({
  n,
  missionId,
  dossierId,
}: {
  n: NoeudArbre;
  missionId: string;
  dossierId: string;
}) {
  const { noeud } = n;
  const etat = etatVerdict(noeud);
  const nbLiens = noeud.liens.length;
  return (
    <li>
      <div className="mp-arbre-dd__noeud">
        <span className="mp-arbre-dd__titre">
          <Link href={hrefHypothese(missionId, dossierId, noeud.id)}>{noeud.libelle}</Link>
        </span>
        <span className="mp-dd-meta">
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
          <p className="mp-texte-petit">{libelleRaisonVerdict("CONFLIT_SOLIDE")}</p>
        ) : null}
      </div>
      {n.enfants.length > 0 ? (
        <ul aria-label={`Sous-hypothèses de ${noeud.libelle}`}>
          {n.enfants.map((e) => (
            <Noeud key={e.noeud.id} n={e} missionId={missionId} dossierId={dossierId} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Arbre d'hypothèses (DD-09, profondeur 4 au plus) : liste imbriquée, chaque nœud avec son état
 * (confirmée, infirmée, non concluante, en attente, ouverte), l'indication du moteur et la plus
 * faible solidité de ses sources. Composant serveur : les données sont déjà calculées par l'API.
 */
export function ArbreHypotheses({ missionId, dossierId, arbre }: ArbreHypothesesProps) {
  return (
    <ul className="mp-arbre-dd" aria-label="Arbre des hypothèses">
      {arbre.map((n) => (
        <Noeud key={n.noeud.id} n={n} missionId={missionId} dossierId={dossierId} />
      ))}
    </ul>
  );
}

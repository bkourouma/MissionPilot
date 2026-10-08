import { contenuRapport, NIVEAUX, type NiveauRapport } from "../../lib/rapports";
import { Alerte } from "../ui/Alerte";
import { Icone } from "../ui/Icone";
import { BadgeNiveau } from "./BadgeNiveau";

export interface ContenuRapportProps {
  niveau: NiveauRapport;
  /** Identifiant du bloc (référencé par `aria-describedby` du bouton de génération). */
  id?: string;
}

/**
 * Ce que contiendra le rapport avec les droits de l'utilisateur : sections incluses et
 * exclues, décrites en mots. Aucun montant n'est affiché ici, quel que soit le niveau.
 */
export function ContenuRapport({ niveau, id }: ContenuRapportProps) {
  const { inclus, exclus } = contenuRapport(niveau);
  return (
    <div className="mp-rapport-contenu" id={id}>
      <p className="mp-rapport-contenu__niveau">
        <span>Niveau du rapport :</span> <BadgeNiveau niveau={niveau} />
      </p>
      <p>{NIVEAUX[niveau].explication}</p>
      <div className="mp-rapport-contenu__colonnes">
        <div>
          <h3 className="mp-rapport-contenu__titre">Ce que contiendra le rapport</h3>
          <ul className="mp-rapport-contenu__liste">
            {inclus.map((s) => (
              <li key={s}>
                <Icone nom="succes" taille={18} />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        {exclus.length > 0 ? (
          <div>
            <h3 className="mp-rapport-contenu__titre">Non inclus avec vos droits</h3>
            <ul className="mp-rapport-contenu__liste mp-rapport-contenu__liste--exclus">
              {exclus.map((s) => (
                <li key={s}>
                  <Icone nom="neutre" taille={18} />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {niveau === "finance" ? (
        <Alerte tonalite="attention" titre="Rapport confidentiel" annonce="aucune">
          <p>
            Il contiendra les coûts internes, taux et marges du cabinet : ne le transmettez pas au
            client tel quel. Seules les personnes qui ont accès aux finances du cabinet (associés,
            gestionnaires) pourront l&apos;ouvrir.
          </p>
        </Alerte>
      ) : null}
      <p className="mp-indice mp-texte-petit">
        <Icone nom="info" taille={16} />
        <span>
          Le rapport est produit au statut « Brouillon », indiqué sur chaque page du document :
          relisez-le avant toute diffusion.
        </span>
      </p>
    </div>
  );
}

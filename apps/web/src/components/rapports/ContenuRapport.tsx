import { contenuRapport, niveauRapport, type NiveauRapport } from "../../lib/rapports";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const { inclus, exclus } = contenuRapport(niveau, langue);
  return (
    <div className="mp-rapport-contenu" id={id}>
      <p className="mp-rapport-contenu__niveau">
        <span>{t("Niveau du rapport :", "Report level:")}</span> <BadgeNiveau niveau={niveau} />
      </p>
      <p>{niveauRapport(niveau, langue).explication}</p>
      <div className="mp-rapport-contenu__colonnes">
        <div>
          <h3 className="mp-rapport-contenu__titre">
            {t("Ce que contiendra le rapport", "What the report will contain")}
          </h3>
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
            <h3 className="mp-rapport-contenu__titre">
              {t("Non inclus avec vos droits", "Not included with your rights")}
            </h3>
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
        <Alerte
          tonalite="attention"
          titre={t("Rapport confidentiel", "Confidential report")}
          annonce="aucune"
        >
          <p>
            {t(
              "Il contiendra les coûts internes, taux et marges du cabinet : ne le transmettez pas au client tel quel. Seules les personnes qui ont accès aux finances du cabinet (associés, gestionnaires) pourront l'ouvrir.",
              "It will contain the firm's internal costs, rates and margins: do not send it to the client as is. Only people with access to the firm's financials (partners, managers) will be able to open it.",
            )}
          </p>
        </Alerte>
      ) : null}
      <p className="mp-indice mp-texte-petit">
        <Icone nom="info" taille={16} />
        <span>
          {t(
            "Le rapport est produit au statut « Brouillon », indiqué sur chaque page du document : relisez-le avant toute diffusion.",
            "The report is produced with the “Draft” status, shown on every page of the document: review it before any distribution.",
          )}
        </span>
      </p>
    </div>
  );
}

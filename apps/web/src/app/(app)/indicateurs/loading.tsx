import { Squelette } from "../../../components/ui/Squelette";
import { obtenirT } from "../../../lib/i18n/serveur";

export default async function Chargement() {
  const t = await obtenirT();
  return (
    <div className="mp-page">
      <Squelette
        avecTitre
        lignes={1}
        libelle={t("Calcul des indicateurs…", "Computing the indicators…")}
      />
      <div className="mp-grille-indicateurs" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="mp-squelette__forme mp-indicateur--squelette" />
        ))}
      </div>
    </div>
  );
}

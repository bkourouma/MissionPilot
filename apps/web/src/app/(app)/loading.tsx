import { Squelette } from "../../components/ui/Squelette";
import { obtenirT } from "../../lib/i18n/serveur";

/**
 * Squelette générique d'une page : titre et sous-titre, barre d'actions, trois cartes, puis une
 * liste. Les formes sont décoratives (masquées aux technologies d'assistance) ; le seul message
 * annoncé est celui de `Squelette` (role="status").
 */
export default async function Chargement() {
  const t = await obtenirT();
  return (
    <div className="mp-page mp-chargement">
      <div className="mp-chargement__entete" aria-hidden="true">
        <span className="mp-chargement__forme mp-chargement__titre" />
        <span className="mp-chargement__forme mp-chargement__soustitre" />
      </div>
      <div className="mp-chargement__actions" aria-hidden="true">
        <span className="mp-chargement__forme mp-chargement__bouton" />
        <span className="mp-chargement__forme mp-chargement__bouton mp-chargement__bouton--court" />
      </div>
      <div className="mp-chargement__cartes" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mp-chargement__carte">
            <span className="mp-chargement__forme mp-chargement__carte-titre" />
            <span className="mp-chargement__forme mp-chargement__carte-chiffre" />
          </div>
        ))}
      </div>
      <div className="mp-chargement__liste">
        <Squelette lignes={5} libelle={t("Chargement de la page…", "Loading page…")} />
      </div>
    </div>
  );
}

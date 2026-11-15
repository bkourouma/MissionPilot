import Link from "next/link";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { descriptionAlerte, hrefKpi } from "../../lib/kpi";
import { Icone } from "../ui/Icone";

export interface AlerteAffichee {
  /** Clé React stable. */
  cle: string;
  code: string;
  periode: string;
  unite: string;
  /** KPI concerné (liste du tableau de bord) : lien vers sa fiche. */
  kpi?: { id: string; libelle: string };
  donnees: Record<string, unknown>;
  /** Date de détection (alertes enregistrées). */
  detectee?: string;
}

/**
 * Alertes du moteur (dégradation continue, mesure en retard, seuils d'alerte, variation) :
 * chacune a un titre écrit et une phrase qui donne les chiffres ; l'icône est décorative.
 */
export async function ListeAlertesKpi({
  alertes,
  missionId,
}: {
  alertes: readonly AlerteAffichee[];
  missionId: string;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <ul className="mp-kpi-alertes">
      {alertes.map((a) => {
        const d = descriptionAlerte(
          { ...a.donnees, code: a.code, periode: a.periode },
          a.unite,
          langue,
        );
        return (
          <li key={a.cle} className={`mp-kpi-alerte mp-kpi-alerte--${d.tonalite}`}>
            <Icone nom={d.tonalite === "danger" ? "danger" : "attention"} taille={18} />
            <div className="mp-kpi-alerte__contenu">
              <p className="mp-kpi-alerte__titre">
                <span className="mp-visuellement-cache">{t("Alerte : ", "Alert: ")}</span>
                {d.titre}
                {a.kpi ? (
                  <>
                    {" — "}
                    <Link href={hrefKpi(missionId, a.kpi.id)}>{a.kpi.libelle}</Link>
                  </>
                ) : null}
              </p>
              <p>{d.texte}</p>
              {a.detectee ? <p className="mp-texte-doux mp-texte-petit">{a.detectee}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

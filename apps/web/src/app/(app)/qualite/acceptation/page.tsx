import Link from "next/link";
import type { Metadata } from "next";
import "../../../../components/qualite/qualite.css";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { libelleStatutMission, STATUT_MISSION, type Mission } from "../../../../lib/missions";
import { chargerToutesLesPages, LIMITE_PAGE_MAX } from "../../../../lib/pagination";
import { hrefAcceptation } from "../../../../lib/qualite";
import { exigerRelectureQualite } from "../../../../lib/qualite-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Acceptation de mission", "Engagement acceptance") };
}

/** Choix de la mission dont on évalue l'acceptation (conflits d'intérêts, profil de risque). */
export default async function PageAcceptations() {
  await exigerRelectureQualite();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerToutesLesPages<Mission>(chargerServeur, "/api/missions", {
    limiteMax: LIMITE_PAGE_MAX,
  });
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Acceptation de mission", "Engagement acceptance")}
        soustitre={t(
          "Avant de s'engager : conflits d'intérêts avec les clients liés du cabinet et profil de risque du client.",
          "Before committing: conflicts of interest with the firm's related clients and the client's risk profile.",
        )}
        retour={{ href: "/qualite", libelle: t("Qualité", "Quality") }}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les missions n'ont pas pu être chargées.",
            "The engagements could not be loaded.",
          )}
          message={r.message}
          hrefReessayer="/qualite/acceptation"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune mission visible.", "No visible engagement.")} icone="signature">
          <p>
            {t(
              "Créez une mission pour en évaluer l'acceptation.",
              "Create an engagement to assess its acceptance.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {r.donnees.elements.map((m) => (
            <li key={m.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={hrefAcceptation(m.id)} className="mp-lien-ligne">
                  {m.intitule}
                </Link>
                <span className="mp-texte-doux mp-texte-petit">{m.client_raison_sociale}</span>
              </div>
              <BadgeStatut tonalite={STATUT_MISSION[m.statut].tonalite}>
                {libelleStatutMission(m.statut, langue)}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      )}
      {r.ok && r.donnees.tronquee ? (
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "La liste est tronquée : affinez depuis la page des missions.",
            "The list is truncated: refine from the engagements page.",
          )}
        </p>
      ) : null}
    </div>
  );
}

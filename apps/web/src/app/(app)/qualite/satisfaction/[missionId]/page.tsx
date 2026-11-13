import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/qualite/qualite.css";
import { FormulaireSatisfaction } from "../../../../../components/qualite/FormulaireSatisfaction";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import type { MissionDetaillee } from "../../../../../lib/missions";
import {
  cheminSatisfactions,
  formaterNps,
  hrefSatisfaction,
  type VueSatisfactions,
} from "../../../../../lib/qualite";
import { exigerRelectureQualite } from "../../../../../lib/qualite-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Satisfaction du client", "Client satisfaction") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DecoupageJalons {
  jalons: { id: string; libelle: string }[];
}

/** Notes de satisfaction d'une mission (QUA-08) : saisie par jalon ou à la clôture, NPS de la mission. */
export default async function PageSatisfaction({
  params,
}: {
  params: Promise<{ missionId: string }>;
}) {
  await exigerRelectureQualite();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { missionId } = await params;
  if (!UUID.test(missionId)) notFound();
  const [mission, r, decoupage] = await Promise.all([
    chargerServeur<MissionDetaillee>(`/api/missions/${encodeURIComponent(missionId)}`),
    chargerServeur<VueSatisfactions>(cheminSatisfactions(missionId)),
    chargerServeur<DecoupageJalons>(`/api/missions/${encodeURIComponent(missionId)}/decoupage`),
  ]);
  if ((!mission.ok && mission.statut === 404) || (!r.ok && r.statut === 404)) notFound();

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t(
          `Satisfaction : ${mission.ok ? mission.donnees.intitule : "mission"}`,
          `Satisfaction: ${mission.ok ? mission.donnees.intitule : "engagement"}`,
        )}
        soustitre={
          mission.ok
            ? t(
                `Client : ${mission.donnees.client_raison_sociale}`,
                `Client: ${mission.donnees.client_raison_sociale}`,
              )
            : undefined
        }
        retour={{
          href: "/qualite/satisfaction",
          libelle: t("Satisfaction des clients", "Client satisfaction"),
        }}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t("Les notes n'ont pas pu être chargées.", "The scores could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefSatisfaction(missionId)}
        />
      ) : (
        <>
          <Carte titre={t("Notes en vigueur", "Current scores")}>
            {r.donnees.notes.length === 0 ? (
              <EtatVide titre={t("Aucune note recueillie.", "No score collected.")} icone="info">
                <p>
                  {t(
                    "Saisissez la note du client à un jalon atteint ou à la clôture.",
                    "Enter the client's score at a milestone reached or at close-out.",
                  )}
                </p>
              </EtatVide>
            ) : (
              <div className="mp-qualite__section">
                <div className="mp-qualite-nps">
                  <p
                    className="mp-qualite-nps__valeur"
                    aria-label={t(
                      `NPS de la mission : ${formaterNps(r.donnees.synthese.nps, langue)}`,
                      `Engagement NPS: ${formaterNps(r.donnees.synthese.nps, langue)}`,
                    )}
                  >
                    {formaterNps(r.donnees.synthese.nps, langue)}
                  </p>
                  <p className="mp-qualite-nps__detail">
                    <span>
                      {t(
                        `${r.donnees.synthese.total} note(s)`,
                        `${r.donnees.synthese.total} score(s)`,
                      )}
                    </span>
                    <span>
                      {t(
                        `${r.donnees.synthese.promoteurs} promoteur(s)`,
                        `${r.donnees.synthese.promoteurs} promoter(s)`,
                      )}
                    </span>
                    <span>
                      {t(
                        `${r.donnees.synthese.detracteurs} détracteur(s)`,
                        `${r.donnees.synthese.detracteurs} detractor(s)`,
                      )}
                    </span>
                  </p>
                </div>
                <ul className="mp-liste-lignes">
                  {r.donnees.notes.map((n) => (
                    <li key={n.id} className="mp-liste-lignes__ligne">
                      <div className="mp-liste-lignes__texte">
                        <span>
                          {n.moment === "cloture"
                            ? t("Clôture de la mission", "Engagement close-out")
                            : (n.jalon_libelle ?? t("Jalon", "Milestone"))}
                        </span>
                        <span className="mp-texte-doux mp-texte-petit">
                          {formaterDateHeure(n.saisi_le, undefined, langue)}
                          {n.repondant ? ` · ${n.repondant}` : ""}
                          {n.rang > 1
                            ? t(
                                ` · note corrigée (saisie n° ${n.rang})`,
                                ` · score corrected (entry no. ${n.rang})`,
                              )
                            : ""}
                        </span>
                        {n.commentaire ? (
                          <span className="mp-texte-petit">« {n.commentaire} »</span>
                        ) : null}
                      </div>
                      <BadgeStatut
                        tonalite={n.note >= 9 ? "succes" : n.note >= 7 ? "neutre" : "attention"}
                      >
                        {n.note} {t("sur 10", "out of 10")}
                      </BadgeStatut>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Carte>
          <Carte titre={t("Saisir une note", "Enter a score")}>
            <FormulaireSatisfaction
              missionId={missionId}
              jalons={
                decoupage.ok
                  ? decoupage.donnees.jalons.map((j) => ({ id: j.id, libelle: j.libelle }))
                  : []
              }
            />
          </Carte>
        </>
      )}
    </div>
  );
}

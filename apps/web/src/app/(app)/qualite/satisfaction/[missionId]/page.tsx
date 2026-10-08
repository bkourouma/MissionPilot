import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/qualite/qualite.css";
import { FormulaireSatisfaction } from "../../../../../components/qualite/FormulaireSatisfaction";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import type { MissionDetaillee } from "../../../../../lib/missions";
import {
  cheminSatisfactions,
  formaterNps,
  hrefSatisfaction,
  type VueSatisfactions,
} from "../../../../../lib/qualite";
import { exigerRelectureQualite } from "../../../../../lib/qualite-serveur";

export const metadata: Metadata = { title: "Satisfaction du client" };

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
        titre={`Satisfaction : ${mission.ok ? mission.donnees.intitule : "mission"}`}
        soustitre={mission.ok ? `Client : ${mission.donnees.client_raison_sociale}` : undefined}
        retour={{ href: "/qualite/satisfaction", libelle: "Satisfaction des clients" }}
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les notes n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefSatisfaction(missionId)}
        />
      ) : (
        <>
          <Carte titre="Notes en vigueur">
            {r.donnees.notes.length === 0 ? (
              <EtatVide titre="Aucune note recueillie." icone="info">
                <p>Saisissez la note du client à un jalon atteint ou à la clôture.</p>
              </EtatVide>
            ) : (
              <div className="mp-qualite__section">
                <div className="mp-qualite-nps">
                  <p
                    className="mp-qualite-nps__valeur"
                    aria-label={`NPS de la mission : ${formaterNps(r.donnees.synthese.nps)}`}
                  >
                    {formaterNps(r.donnees.synthese.nps)}
                  </p>
                  <p className="mp-qualite-nps__detail">
                    <span>{r.donnees.synthese.total} note(s)</span>
                    <span>{r.donnees.synthese.promoteurs} promoteur(s)</span>
                    <span>{r.donnees.synthese.detracteurs} détracteur(s)</span>
                  </p>
                </div>
                <ul className="mp-liste-lignes">
                  {r.donnees.notes.map((n) => (
                    <li key={n.id} className="mp-liste-lignes__ligne">
                      <div className="mp-liste-lignes__texte">
                        <span>
                          {n.moment === "cloture"
                            ? "Clôture de la mission"
                            : (n.jalon_libelle ?? "Jalon")}
                        </span>
                        <span className="mp-texte-doux mp-texte-petit">
                          {formaterDateHeure(n.saisi_le)}
                          {n.repondant ? ` · ${n.repondant}` : ""}
                          {n.rang > 1 ? ` · note corrigée (saisie n° ${n.rang})` : ""}
                        </span>
                        {n.commentaire ? (
                          <span className="mp-texte-petit">« {n.commentaire} »</span>
                        ) : null}
                      </div>
                      <BadgeStatut
                        tonalite={n.note >= 9 ? "succes" : n.note >= 7 ? "neutre" : "attention"}
                      >
                        {n.note} sur 10
                      </BadgeStatut>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Carte>
          <Carte titre="Saisir une note">
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

import Link from "next/link";
import type { Metadata } from "next";
import "../../../../components/qualite/qualite.css";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { STATUT_MISSION, type Mission } from "../../../../lib/missions";
import { chargerToutesLesPages } from "../../../../lib/pagination";
import {
  droitsQualite,
  formaterNps,
  hrefSatisfaction,
  type SyntheseCabinet,
} from "../../../../lib/qualite";
import { exigerRelectureQualite } from "../../../../lib/qualite-serveur";

export const metadata: Metadata = { title: "Satisfaction des clients" };

/**
 * Satisfaction des clients (QUA-08) : saisie par mission, NPS du cabinet visible de l'associé
 * seul (l'API refuse les autres rôles).
 */
export default async function PageSatisfactions() {
  const session = await exigerRelectureQualite();
  const droits = droitsQualite(session.utilisateur.roles);
  const [synthese, missions] = await Promise.all([
    droits.associe
      ? chargerServeur<SyntheseCabinet>("/api/qualite/satisfaction/synthese")
      : Promise.resolve(null),
    chargerToutesLesPages<Mission>(chargerServeur, "/api/missions"),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Satisfaction des clients"
        soustitre="Une note de recommandation de 0 à 10 à chaque jalon et à la clôture de la mission."
        retour={{ href: "/qualite", libelle: "Qualité" }}
      />

      {synthese ? (
        <Carte titre="NPS du cabinet">
          {!synthese.ok ? (
            <EtatErreur
              titre="La synthèse n'a pas pu être chargée."
              message={synthese.message}
              hrefReessayer="/qualite/satisfaction"
            />
          ) : synthese.donnees.synthese.total === 0 ? (
            <EtatVide titre="Aucune note recueillie." icone="info">
              <p>Le NPS apparaîtra dès la première note saisie sur une mission.</p>
            </EtatVide>
          ) : (
            <div className="mp-qualite__section">
              <div className="mp-qualite-nps">
                <p
                  className="mp-qualite-nps__valeur"
                  aria-label={`NPS : ${formaterNps(synthese.donnees.synthese.nps)}`}
                >
                  {formaterNps(synthese.donnees.synthese.nps)}
                </p>
                <p className="mp-qualite-nps__detail">
                  <span>{synthese.donnees.synthese.total} note(s)</span>
                  <span>{synthese.donnees.synthese.promoteurs} promoteur(s)</span>
                  <span>{synthese.donnees.synthese.passifs} passif(s)</span>
                  <span>{synthese.donnees.synthese.detracteurs} détracteur(s)</span>
                </p>
              </div>
              <ul className="mp-liste-lignes">
                {synthese.donnees.missions.map((m) => (
                  <li key={m.mission_id} className="mp-liste-lignes__ligne">
                    <div className="mp-liste-lignes__texte">
                      <Link href={hrefSatisfaction(m.mission_id)} className="mp-lien-ligne">
                        {m.mission_intitule}
                      </Link>
                      <span className="mp-texte-doux mp-texte-petit">{m.total} note(s)</span>
                    </div>
                    <BadgeStatut
                      tonalite={m.nps !== null && !m.nps.startsWith("-") ? "succes" : "attention"}
                    >
                      NPS {formaterNps(m.nps)}
                    </BadgeStatut>
                  </li>
                ))}
              </ul>
              {synthese.donnees.tronque ? (
                <p className="mp-texte-doux mp-texte-petit">
                  Seules les premières missions sont listées.
                </p>
              ) : null}
            </div>
          )}
        </Carte>
      ) : null}

      <section aria-labelledby="titre-missions" className="mp-pile">
        <h2 id="titre-missions" className="mp-section__titre">
          Saisir une note
        </h2>
        {!missions.ok ? (
          <EtatErreur
            titre="Les missions n'ont pas pu être chargées."
            message={missions.message}
            hrefReessayer="/qualite/satisfaction"
          />
        ) : missions.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune mission visible." icone="info" />
        ) : (
          <ul className="mp-liste-lignes">
            {missions.donnees.elements.map((m) => (
              <li key={m.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={hrefSatisfaction(m.id)} className="mp-lien-ligne">
                    {m.intitule}
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">{m.client_raison_sociale}</span>
                </div>
                <BadgeStatut tonalite={STATUT_MISSION[m.statut].tonalite}>
                  {STATUT_MISSION[m.statut].libelle}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

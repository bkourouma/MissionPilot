import Link from "next/link";
import type { Metadata } from "next";
import {
  BadgeEtatNote,
  BadgeNiveauEs,
  BadgeNiveauRisque,
} from "../../../../../../components/due-diligence/BadgesDd";
import { ControleNote } from "../../../../../../components/due-diligence/ControleNote";
import {
  FourchetteMarche,
  RecoupementMarche,
} from "../../../../../../components/due-diligence/ResultatMarche";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import {
  cheminSynthese,
  FAMILLE_RISQUE_DD_LIBELLES,
  formaterBp,
  hrefDossier,
  hrefEcranDossier,
  METHODE_COURTE_LIBELLES,
  NIVEAU_RISQUE_DD_LIBELLES,
  type SyntheseDossier,
} from "../../../../../../lib/due-diligence";
import { chargerDossier } from "../../../../../../lib/due-diligence-serveur";
import { formaterNombre } from "../../../../../../lib/format";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Synthèse du dossier" };

const NIVEAUX = ["critique", "eleve", "modere", "faible"] as const;

/**
 * Synthèse d'un dossier (DD-01 à DD-15) : compteurs et états calculés par les moteurs de l'API
 * (hypothèses, risques, marché, E&S, plan, note) et bloc « Avant de soumettre la note » avec,
 * pour chaque bloquant ou avertissement, le lien vers l'écran à corriger.
 */
export default async function PageSyntheseDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  await exigerPermission("dd.lire");
  const [dossier, r] = await Promise.all([
    chargerDossier(dossierId),
    chargerServeur<SyntheseDossier>(cheminSynthese(dossierId)),
  ]);
  if (!dossier.ok) return null;
  if (!r.ok) {
    return (
      <EtatErreur
        titre="La synthèse du dossier n'a pas pu être chargée."
        message={r.message}
        hrefReessayer={hrefDossier(id, dossierId)}
      />
    );
  }
  const s = r.donnees;
  const devise = dossier.donnees.devise;
  const compte = (c: keyof SyntheseDossier["compteurs"]) => s.compteurs[c] ?? 0;
  const etatsHypotheses = s.arbre.par_etat;
  const lien = (ecran: Parameters<typeof hrefEcranDossier>[2], libelle: string) => (
    <Link href={hrefEcranDossier(id, dossierId, ecran)}>{libelle}</Link>
  );

  return (
    <>
      <ControleNote missionId={id} dossierId={dossierId} controle={s.controle_note} />

      <div className="mp-dd-grille">
        <Carte
          titre="Hypothèses"
          niveauTitre={3}
          piedDePage={lien("hypotheses", "Ouvrir l'arbre d'hypothèses")}
        >
          {compte("hypotheses") === 0 ? (
            <p className="mp-texte-doux">Aucune hypothèse n&apos;est posée.</p>
          ) : (
            <ul className="mp-dd-decompte" aria-label="Hypothèses par état">
              <li>{`Confirmées : ${etatsHypotheses.confirmee}`}</li>
              <li>{`Infirmées : ${etatsHypotheses.infirmee}`}</li>
              <li>{`Non concluantes : ${etatsHypotheses.non_concluante}`}</li>
              <li>{`En attente de validation : ${etatsHypotheses.en_attente}`}</li>
              <li>{`Ouvertes : ${etatsHypotheses.ouverte}`}</li>
            </ul>
          )}
          {s.arbre.incoherences.length > 0 ? (
            <p className="mp-texte-petit">
              {`${s.arbre.incoherences.length} incohérence(s) dans l'arbre : un parent confirmé a un enfant infirmé, ou l'inverse.`}
            </p>
          ) : null}
        </Carte>

        <Carte titre="Risques" niveauTitre={3} piedDePage={lien("risques", "Ouvrir les risques")}>
          {s.risques.total === 0 ? (
            <p className="mp-texte-doux">Aucun risque n&apos;est enregistré.</p>
          ) : (
            <ul className="mp-dd-liste" aria-label="Risques par famille">
              {s.risques.familles
                .filter((f) => f.total > 0)
                .map((f) => (
                  <li key={f.famille} className="mp-dd-meta">
                    <span>{`${FAMILLE_RISQUE_DD_LIBELLES[f.famille]} : ${f.total}`}</span>
                    <span className="mp-texte-doux mp-texte-petit">
                      {NIVEAUX.filter((n) => f.par_niveau[n] > 0)
                        .map(
                          (n) => `${NIVEAU_RISQUE_DD_LIBELLES[n].toLowerCase()} ${f.par_niveau[n]}`,
                        )
                        .join(", ")}
                    </span>
                    {f.niveau_max ? <BadgeNiveauRisque niveau={f.niveau_max} /> : null}
                  </li>
                ))}
            </ul>
          )}
          {s.risques.a_documenter.length > 0 ? (
            <p className="mp-texte-petit">
              {`${s.risques.a_documenter.length} risque(s) élevé(s) ou critique(s) à documenter : source absente ou fragile.`}
            </p>
          ) : null}
        </Carte>

        <Carte
          titre="Marché"
          niveauTitre={3}
          piedDePage={lien("marche", "Ouvrir le dimensionnement")}
        >
          {s.marche.dimensionnements.length === 0 ? (
            <p className="mp-texte-doux">Aucun dimensionnement de marché n&apos;est enregistré.</p>
          ) : (
            <div className="mp-dd-pile">
              {s.marche.dimensionnements.map((d) => (
                <div key={d.id} className="mp-dd-pile">
                  <p className="mp-dd-element__titre">{`${d.libelle} (${METHODE_COURTE_LIBELLES[d.methode].toLowerCase()})`}</p>
                  <FourchetteMarche
                    fourchette={d.resultat}
                    devise={devise}
                    titre={`Fourchette : ${d.libelle}`}
                  />
                </div>
              ))}
            </div>
          )}
          {s.marche.recoupement ? <RecoupementMarche recoupement={s.marche.recoupement} /> : null}
        </Carte>

        <Carte
          titre="Environnement et social"
          niveauTitre={3}
          piedDePage={lien("environnement-social", "Ouvrir la revue E&S")}
        >
          {s.filtrage_es === null ? (
            <p className="mp-texte-doux">
              Aucune revue environnementale et sociale n&apos;est réalisée.
            </p>
          ) : (
            <div className="mp-dd-pile">
              <span className="mp-dd-meta">
                <BadgeNiveauEs niveau={s.filtrage_es.niveau_global} />
                <BadgeStatut tonalite={s.filtrage_es.bloquant ? "danger" : "succes"}>
                  {s.filtrage_es.bloquant
                    ? "Exclusion non levée : bloquant"
                    : "Aucune exclusion bloquante"}
                </BadgeStatut>
              </span>
              <p className="mp-texte-petit">
                {`Exclusions non levées : ${s.filtrage_es.touches_bloquantes}. Thèmes à documenter : ${s.filtrage_es.a_documenter.length}.`}
              </p>
            </div>
          )}
        </Carte>

        <Carte
          titre="Plan des 100 jours"
          niveauTitre={3}
          piedDePage={lien("plan-100-jours", "Ouvrir le plan")}
        >
          {s.plan_100j.total === 0 ? (
            <p className="mp-texte-doux">Aucune action n&apos;est planifiée.</p>
          ) : (
            <div className="mp-dd-pile">
              <p className="mp-dd-chiffre">{formaterBp(s.plan_100j.taux_realisation_bp)}</p>
              <p className="mp-texte-petit">
                {`des actions terminées (${s.plan_100j.terminees} sur ${s.plan_100j.total})`}
              </p>
              <p className="mp-texte-petit">
                {`En retard : ${s.plan_100j.en_retard.length} · Sans responsable : ${s.plan_100j.sans_responsable.length} · Sans indicateur : ${s.plan_100j.sans_indicateur.length}`}
              </p>
            </div>
          )}
        </Carte>

        <Carte titre="Note au comité" niveauTitre={3} piedDePage={lien("note", "Ouvrir les notes")}>
          {s.note === null ? (
            <p className="mp-texte-doux">Aucune note n&apos;est rédigée.</p>
          ) : (
            <div className="mp-dd-meta">
              <BadgeEtatNote etat={s.note.etat} />
              {s.note.derniere_version ? (
                <span className="mp-texte-petit">{`Version ${s.note.derniere_version}`}</span>
              ) : null}
            </div>
          )}
        </Carte>

        <Carte titre="Sources" niveauTitre={3} piedDePage={lien("analyses", "Ouvrir les analyses")}>
          <ul className="mp-dd-decompte" aria-label="Solidité des affirmations">
            <li>{`Solides : ${s.sources.solides}`}</li>
            <li>{`Étayées : ${s.sources.etayees}`}</li>
            <li>{`Fragiles : ${s.sources.fragiles}`}</li>
          </ul>
          {s.sources.anomalies_prv03 > 0 ? (
            <Alerte tonalite="attention" annonce="aucune">
              <p>{`${s.sources.anomalies_prv03} affirmation(s) de classe R2 ou R3 sans preuve ni avis d'expert signé.`}</p>
            </Alerte>
          ) : null}
        </Carte>

        <Carte titre="Dossier" niveauTitre={3}>
          <ul className="mp-dd-decompte" aria-label="Contenu du dossier">
            <li>{`Points d'analyse : ${formaterNombre(compte("points"), 0)}`}</li>
            <li>{`Étapes de chaîne : ${formaterNombre(compte("etapes"), 0)}`}</li>
            <li>{`Risques : ${formaterNombre(compte("risques"), 0)}`}</li>
            <li>{`Hypothèses : ${formaterNombre(compte("hypotheses"), 0)}`}</li>
            <li>{`Actions : ${formaterNombre(compte("actions"), 0)}`}</li>
          </ul>
          <p className="mp-texte-petit">
            {`Signaux d'alerte : ${s.signaux.applicables} applicable(s), ${s.signaux.constates} constaté(s), ${s.signaux.a_verifier} à vérifier. `}
            {lien("ajustements", `${s.ajustements.total} ajustement(s) tracé(s)`)}
          </p>
        </Carte>
      </div>
    </>
  );
}

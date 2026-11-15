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
  formaterBp,
  hrefDossier,
  hrefEcranDossier,
  libellesDd,
  METHODE_COURTE_LIBELLES,
  METHODE_COURTE_LIBELLES_EN,
  type SyntheseDossier,
} from "../../../../../../lib/due-diligence";
import { chargerDossier } from "../../../../../../lib/due-diligence-serveur";
import { formaterNombre } from "../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Synthèse du dossier", "File summary") };
}

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
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const L = libellesDd(langue);
  const methodesCourtes = langue === "en" ? METHODE_COURTE_LIBELLES_EN : METHODE_COURTE_LIBELLES;
  await exigerPermission("dd.lire");
  const [dossier, r] = await Promise.all([
    chargerDossier(dossierId),
    chargerServeur<SyntheseDossier>(cheminSynthese(dossierId)),
  ]);
  if (!dossier.ok) return null;
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "La synthèse du dossier n'a pas pu être chargée.",
          "The file summary could not be loaded.",
        )}
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
          titre={t("Hypothèses", "Hypotheses")}
          niveauTitre={3}
          piedDePage={lien(
            "hypotheses",
            t("Ouvrir l'arbre d'hypothèses", "Open the hypothesis tree"),
          )}
        >
          {compte("hypotheses") === 0 ? (
            <p className="mp-texte-doux">
              {t("Aucune hypothèse n'est posée.", "No hypothesis has been set.")}
            </p>
          ) : (
            <ul
              className="mp-dd-decompte"
              aria-label={t("Hypothèses par état", "Hypotheses by state")}
            >
              <li>{`${t("Confirmées", "Confirmed")} : ${etatsHypotheses.confirmee}`}</li>
              <li>{`${t("Infirmées", "Refuted")} : ${etatsHypotheses.infirmee}`}</li>
              <li>{`${t("Non concluantes", "Inconclusive")} : ${etatsHypotheses.non_concluante}`}</li>
              <li>{`${t("En attente de validation", "Pending approval")} : ${etatsHypotheses.en_attente}`}</li>
              <li>{`${t("Ouvertes", "Open")} : ${etatsHypotheses.ouverte}`}</li>
            </ul>
          )}
          {s.arbre.incoherences.length > 0 ? (
            <p className="mp-texte-petit">
              {t(
                `${s.arbre.incoherences.length} incohérence(s) dans l'arbre : un parent confirmé a un enfant infirmé, ou l'inverse.`,
                `${s.arbre.incoherences.length} inconsistency(ies) in the tree: a confirmed parent has a refuted child, or the reverse.`,
              )}
            </p>
          ) : null}
        </Carte>

        <Carte
          titre={t("Risques", "Risks")}
          niveauTitre={3}
          piedDePage={lien("risques", t("Ouvrir les risques", "Open the risks"))}
        >
          {s.risques.total === 0 ? (
            <p className="mp-texte-doux">
              {t("Aucun risque n'est enregistré.", "No risk is recorded.")}
            </p>
          ) : (
            <ul className="mp-dd-liste" aria-label={t("Risques par famille", "Risks by family")}>
              {s.risques.familles
                .filter((f) => f.total > 0)
                .map((f) => (
                  <li key={f.famille} className="mp-dd-meta">
                    <span>{`${L.FAMILLE[f.famille]} : ${f.total}`}</span>
                    <span className="mp-texte-doux mp-texte-petit">
                      {NIVEAUX.filter((n) => f.par_niveau[n] > 0)
                        .map((n) => `${L.NIVEAU_RISQUE[n].toLowerCase()} ${f.par_niveau[n]}`)
                        .join(", ")}
                    </span>
                    {f.niveau_max ? <BadgeNiveauRisque niveau={f.niveau_max} /> : null}
                  </li>
                ))}
            </ul>
          )}
          {s.risques.a_documenter.length > 0 ? (
            <p className="mp-texte-petit">
              {t(
                `${s.risques.a_documenter.length} risque(s) élevé(s) ou critique(s) à documenter : source absente ou fragile.`,
                `${s.risques.a_documenter.length} high or critical risk(s) to document: source missing or weak.`,
              )}
            </p>
          ) : null}
        </Carte>

        <Carte
          titre={t("Marché", "Market")}
          niveauTitre={3}
          piedDePage={lien("marche", t("Ouvrir le dimensionnement", "Open the sizing"))}
        >
          {s.marche.dimensionnements.length === 0 ? (
            <p className="mp-texte-doux">
              {t(
                "Aucun dimensionnement de marché n'est enregistré.",
                "No market sizing is recorded.",
              )}
            </p>
          ) : (
            <div className="mp-dd-pile">
              {s.marche.dimensionnements.map((d) => (
                <div key={d.id} className="mp-dd-pile">
                  <p className="mp-dd-element__titre">{`${d.libelle} (${methodesCourtes[d.methode].toLowerCase()})`}</p>
                  <FourchetteMarche
                    fourchette={d.resultat}
                    devise={devise}
                    titre={`${t("Fourchette", "Range")} : ${d.libelle}`}
                  />
                </div>
              ))}
            </div>
          )}
          {s.marche.recoupement ? <RecoupementMarche recoupement={s.marche.recoupement} /> : null}
        </Carte>

        <Carte
          titre={t("Environnement et social", "Environmental and social")}
          niveauTitre={3}
          piedDePage={lien("environnement-social", t("Ouvrir la revue E&S", "Open the E&S review"))}
        >
          {s.filtrage_es === null ? (
            <p className="mp-texte-doux">
              {t(
                "Aucune revue environnementale et sociale n'est réalisée.",
                "No environmental and social review has been carried out.",
              )}
            </p>
          ) : (
            <div className="mp-dd-pile">
              <span className="mp-dd-meta">
                <BadgeNiveauEs niveau={s.filtrage_es.niveau_global} />
                <BadgeStatut tonalite={s.filtrage_es.bloquant ? "danger" : "succes"}>
                  {s.filtrage_es.bloquant
                    ? t("Exclusion non levée : bloquant", "Exclusion not cleared: blocking")
                    : t("Aucune exclusion bloquante", "No blocking exclusion")}
                </BadgeStatut>
              </span>
              <p className="mp-texte-petit">
                {t(
                  `Exclusions non levées : ${s.filtrage_es.touches_bloquantes}. Thèmes à documenter : ${s.filtrage_es.a_documenter.length}.`,
                  `Exclusions not cleared: ${s.filtrage_es.touches_bloquantes}. Themes to document: ${s.filtrage_es.a_documenter.length}.`,
                )}
              </p>
            </div>
          )}
        </Carte>

        <Carte
          titre={t("Plan des 100 jours", "100-day plan")}
          niveauTitre={3}
          piedDePage={lien("plan-100-jours", t("Ouvrir le plan", "Open the plan"))}
        >
          {s.plan_100j.total === 0 ? (
            <p className="mp-texte-doux">
              {t("Aucune action n'est planifiée.", "No action is planned.")}
            </p>
          ) : (
            <div className="mp-dd-pile">
              <p className="mp-dd-chiffre">{formaterBp(s.plan_100j.taux_realisation_bp, langue)}</p>
              <p className="mp-texte-petit">
                {t(
                  `des actions terminées (${s.plan_100j.terminees} sur ${s.plan_100j.total})`,
                  `of actions done (${s.plan_100j.terminees} out of ${s.plan_100j.total})`,
                )}
              </p>
              <p className="mp-texte-petit">
                {t(
                  `En retard : ${s.plan_100j.en_retard.length} · Sans responsable : ${s.plan_100j.sans_responsable.length} · Sans indicateur : ${s.plan_100j.sans_indicateur.length}`,
                  `Overdue: ${s.plan_100j.en_retard.length} · No owner: ${s.plan_100j.sans_responsable.length} · No KPI: ${s.plan_100j.sans_indicateur.length}`,
                )}
              </p>
            </div>
          )}
        </Carte>

        <Carte
          titre={t("Note au comité", "Committee memo")}
          niveauTitre={3}
          piedDePage={lien("note", t("Ouvrir les notes", "Open the memos"))}
        >
          {s.note === null ? (
            <p className="mp-texte-doux">
              {t("Aucune note n'est rédigée.", "No memo has been written.")}
            </p>
          ) : (
            <div className="mp-dd-meta">
              <BadgeEtatNote etat={s.note.etat} />
              {s.note.derniere_version ? (
                <span className="mp-texte-petit">{`Version ${s.note.derniere_version}`}</span>
              ) : null}
            </div>
          )}
        </Carte>

        <Carte
          titre={t("Sources", "Sources")}
          niveauTitre={3}
          piedDePage={lien("analyses", t("Ouvrir les analyses", "Open the analyses"))}
        >
          <ul
            className="mp-dd-decompte"
            aria-label={t("Solidité des affirmations", "Strength of statements")}
          >
            <li>{`${t("Solides", "Strong")} : ${s.sources.solides}`}</li>
            <li>{`${t("Étayées", "Supported")} : ${s.sources.etayees}`}</li>
            <li>{`${t("Fragiles", "Weak")} : ${s.sources.fragiles}`}</li>
          </ul>
          {s.sources.anomalies_prv03 > 0 ? (
            <Alerte tonalite="attention" annonce="aucune">
              <p>
                {t(
                  `${s.sources.anomalies_prv03} affirmation(s) de classe R2 ou R3 sans preuve ni avis d'expert signé.`,
                  `${s.sources.anomalies_prv03} statement(s) of class R2 or R3 with no evidence or signed expert opinion.`,
                )}
              </p>
            </Alerte>
          ) : null}
        </Carte>

        <Carte titre={t("Dossier", "File")} niveauTitre={3}>
          <ul className="mp-dd-decompte" aria-label={t("Contenu du dossier", "File content")}>
            <li>{`${t("Points d'analyse", "Analysis items")} : ${formaterNombre(compte("points"), 0, langue)}`}</li>
            <li>{`${t("Étapes de chaîne", "Chain steps")} : ${formaterNombre(compte("etapes"), 0, langue)}`}</li>
            <li>{`${t("Risques", "Risks")} : ${formaterNombre(compte("risques"), 0, langue)}`}</li>
            <li>{`${t("Hypothèses", "Hypotheses")} : ${formaterNombre(compte("hypotheses"), 0, langue)}`}</li>
            <li>{`${t("Actions", "Actions")} : ${formaterNombre(compte("actions"), 0, langue)}`}</li>
          </ul>
          <p className="mp-texte-petit">
            {t(
              `Signaux d'alerte : ${s.signaux.applicables} applicable(s), ${s.signaux.constates} constaté(s), ${s.signaux.a_verifier} à vérifier. `,
              `Warning signals: ${s.signaux.applicables} applicable, ${s.signaux.constates} observed, ${s.signaux.a_verifier} to verify. `,
            )}
            {lien(
              "ajustements",
              t(
                `${s.ajustements.total} ajustement(s) tracé(s)`,
                `${s.ajustements.total} adjustment(s) traced`,
              ),
            )}
          </p>
        </Carte>
      </div>
    </>
  );
}

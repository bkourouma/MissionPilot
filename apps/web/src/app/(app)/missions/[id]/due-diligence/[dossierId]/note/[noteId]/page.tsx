import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { NoteBase } from "@missionpilot/shared";
import { BadgeEtatNote } from "../../../../../../../../components/due-diligence/BadgesDd";
import { ControleNote } from "../../../../../../../../components/due-diligence/ControleNote";
import {
  EditeurNote,
  SoumettreNote,
} from "../../../../../../../../components/due-diligence/EditeurNote";
import { GenerationLivrable } from "../../../../../../../../components/rapports/GenerationLivrable";
import { ValidationDecision } from "../../../../../../../../components/due-diligence/ValidationDecision";
import { Alerte } from "../../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../../lib/api-serveur";
import {
  cheminNote,
  cheminValidationNote,
  droitsDd,
  etatNote,
  hrefEcranDossier,
  hrefNote,
  libelleRecommandation,
  peutValiderSansConflit,
  versionValidee,
  VERDICT_DD_LIBELLES,
  type NoteDetail,
} from "../../../../../../../../lib/due-diligence";
import { formaterDateHeure, formaterMontantMineur } from "../../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../../lib/identifiant";
import { chargerDossier } from "../../../../../../../../lib/due-diligence-serveur";
import { chargerMission } from "../../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../../lib/session";

export const metadata: Metadata = { title: "Note au comité" };

/**
 * Une note au comité (DD-13) : versions, contrôle du moteur, soumission, validation par un tiers
 * (jamais l'auteur de la note, sauf associé) et rapports. Une version soumise est figée : sa base de
 * chiffres et son contrôle ne changent plus.
 */
export default async function PageNoteDd({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; dossierId: string; noteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, dossierId, noteId } = await params;
  if (!estIdentifiant(noteId)) notFound();
  const { utilisateur } = await exigerPermission("dd.lire");
  const [mission, dossier] = await Promise.all([chargerMission(id), chargerDossier(dossierId)]);
  if (!mission.ok || !dossier.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const demandee = Number((await searchParams).version);
  const version = Number.isInteger(demandee) && demandee >= 1 ? demandee : null;
  const r = await chargerServeur<NoteDetail & { base_figee?: NoteBase | null }>(
    cheminNote(noteId, version),
  );
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre="La note n'a pas pu être chargée."
        message={r.message}
        hrefReessayer={hrefNote(id, dossierId, noteId)}
      />
    );
  }
  const n = r.donnees;
  if (n.dossier_id && n.dossier_id !== dossierId) notFound();
  const etat = etatNote(n);
  const validee = versionValidee(n);
  const versions = [...n.versions].sort((a, b) => b.version - a.version);
  const derniere = versions[0];
  const peutSoumettre = droits.ecrire && derniere?.etat === "brouillon" && etat === "brouillon";
  const aSoumise = derniere?.etat === "soumise" ? derniere : undefined;
  const decisionRendue = aSoumise
    ? n.validations.some((v) => (v.note_version ?? v.version) === aSoumise.version)
    : true;
  const auteurs = [n.cree_par, ...n.versions.map((v) => v.cree_par)];
  const peutDecider =
    !decisionRendue &&
    droits.valider &&
    peutValiderSansConflit(utilisateur.roles, utilisateur.id, auteurs);
  const base = n.base_figee ?? null;
  const devise = dossier.donnees.devise;

  return (
    <>
      <section className="mp-dd-pile" aria-labelledby="titre-note">
        <p className="mp-texte-petit">
          <Link href={hrefEcranDossier(id, dossierId, "note")}>Toutes les notes</Link>
        </p>
        <h3 id="titre-note" className="mp-section__titre">
          {n.titre}
        </h3>
        <div className="mp-dd-meta">
          <BadgeEtatNote etat={etat} />
          {validee ? (
            <BadgeStatut tonalite="succes">{`Version ${validee} validée`}</BadgeStatut>
          ) : null}
        </div>
      </section>

      <div className="mp-note-corps">
        <div className="mp-dd-pile">
          <Carte
            titre={`Version ${n.contenu.version}${n.contenu.etat === "soumise" ? " (soumise)" : " (brouillon)"}`}
            niveauTitre={3}
          >
            <div className="mp-dd-pile">
              <p>
                <strong>{`Recommandation : ${libelleRecommandation(n.contenu.recommandation)}`}</strong>
              </p>
              <p className="mp-dd-texte">{n.contenu.synthese}</p>
              {n.contenu.conditions.length > 0 ? (
                <ul className="mp-liste-simple" aria-label="Conditions">
                  {n.contenu.conditions.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : null}
              {n.contenu.soumise_le ? (
                <p className="mp-texte-doux mp-texte-petit">{`Soumise le ${formaterDateHeure(n.contenu.soumise_le)}`}</p>
              ) : null}
            </div>
          </Carte>

          {base ? (
            <Carte titre="Base figée à la soumission" niveauTitre={3}>
              <div className="mp-dd-pile">
                <p className="mp-texte-doux mp-texte-petit">
                  {`Calculée par les moteurs le ${base.genere_le}; elle ne change plus.`}
                </p>
                <ul className="mp-dd-liste" aria-label="Verdicts validés">
                  {base.hypotheses.map((h) => (
                    <li key={h.id} className="mp-dd-element">
                      <p className="mp-dd-element__titre">{h.libelle}</p>
                      <p className="mp-texte-petit">
                        {h.verdict ? VERDICT_DD_LIBELLES[h.verdict] : "Sans verdict"}
                      </p>
                    </li>
                  ))}
                </ul>
                {base.marche.present
                  ? base.marche.dimensionnements.map((d) => (
                      <p key={`${d.methode}-${d.libelle}`} className="mp-texte-petit">
                        {`${d.libelle} : ${formaterMontantMineur(d.resultat.bas, devise)} à ${formaterMontantMineur(d.resultat.haut, devise)} (central ${formaterMontantMineur(d.resultat.base, devise)})`}
                      </p>
                    ))
                  : null}
                <p className="mp-texte-petit">
                  {`${base.risques.length} risque(s), ${base.plan_100j.total} action(s) du plan, ${base.ajustements.length} ajustement(s) tracé(s).`}
                </p>
              </div>
            </Carte>
          ) : null}

          <Carte titre="Versions" niveauTitre={3}>
            <ol
              className="mp-dd-liste"
              aria-label="Versions de la note, de la plus récente à la plus ancienne"
            >
              {versions.map((v) => (
                <li key={v.version} className="mp-dd-element">
                  <span className="mp-dd-meta">
                    <Link href={`${hrefNote(id, dossierId, noteId)}?version=${v.version}`}>
                      {`Version ${v.version}`}
                    </Link>
                    <BadgeStatut tonalite={v.etat === "soumise" ? "attention" : "neutre"} sansIcone>
                      {v.etat === "soumise" ? "Soumise" : "Brouillon"}
                    </BadgeStatut>
                    <span className="mp-texte-doux mp-texte-petit">
                      {formaterDateHeure(v.cree_le)}
                    </span>
                  </span>
                  {v.motif ? <p className="mp-dd-texte">{`Motif : ${v.motif}`}</p> : null}
                </li>
              ))}
            </ol>
          </Carte>

          {n.validations.length > 0 ? (
            <Carte titre="Décisions" niveauTitre={3}>
              <ul className="mp-dd-liste">
                {n.validations.map((v) => (
                  <li
                    key={`${v.note_version ?? v.version}-${v.valide_le}`}
                    className="mp-dd-element"
                  >
                    <BadgeStatut tonalite={v.decision === "valide" ? "succes" : "danger"}>
                      {`Version ${v.note_version ?? v.version} : ${v.decision === "valide" ? "validée" : "rejetée"}`}
                    </BadgeStatut>
                    <p className="mp-texte-doux mp-texte-petit">{formaterDateHeure(v.valide_le)}</p>
                    {v.motif ? <p className="mp-dd-texte">{`Motif : ${v.motif}`}</p> : null}
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}
        </div>

        <div className="mp-dd-pile">
          <ControleNote
            missionId={id}
            dossierId={dossierId}
            controle={n.controle}
            titre={
              n.contenu.etat === "soumise"
                ? "Contrôle figé à la soumission"
                : "Contrôle du brouillon"
            }
          />
          {peutSoumettre && derniere ? (
            <Carte titre="Soumettre pour validation" niveauTitre={3}>
              <SoumettreNote
                noteId={noteId}
                version={derniere.version}
                bloque={!n.controle.soumissible}
              />
            </Carte>
          ) : null}
          {aSoumise && !decisionRendue ? (
            <Carte titre="Validation" niveauTitre={3}>
              {peutDecider ? (
                <ValidationDecision
                  chemin={cheminValidationNote(noteId)}
                  corps={{ version: aSoumise.version }}
                  objet="cette version de la note"
                  succesValide="Note validée : le rapport peut être généré."
                  succesRejete="Note rejetée : rédigez un nouveau brouillon."
                />
              ) : (
                <Alerte tonalite="info" annonce="aucune">
                  <p>
                    {droits.valider
                      ? "Vous avez contribué à cette note : une autre personne doit la valider (un associé peut le faire)."
                      : "La version soumise attend la validation d'une autre personne."}
                  </p>
                </Alerte>
              )}
            </Carte>
          ) : null}
          {droits.ecrire && derniere && etat !== "soumise" ? (
            <details className="mp-dd-details">
              <summary>Nouvelle version (brouillon)</summary>
              <div className="mp-dd-details__corps">
                <EditeurNote
                  missionId={id}
                  dossierId={dossierId}
                  note={{
                    id: noteId,
                    versionCourante: derniere.version,
                    recommandation: n.contenu.recommandation,
                    synthese: n.contenu.synthese,
                    conditions: n.contenu.conditions,
                  }}
                />
              </div>
            </details>
          ) : null}
        </div>
      </div>

      <Carte titre="Rapport" niveauTitre={3}>
        <GenerationLivrable
          type="note_comite"
          id={noteId}
          version={validee}
          cloturee={mission.donnees.statut === "cloturee"}
          indisponible={
            validee === null
              ? "Le rapport n'est généré qu'à partir d'une version validée par une autre personne que l'auteur. Soumettez la note, puis faites-la valider."
              : undefined
          }
        />
      </Carte>
    </>
  );
}

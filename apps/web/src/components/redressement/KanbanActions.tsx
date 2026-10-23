"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  RED_COLONNES_KANBAN,
  type RedActionVue,
  type RedColonneKanban,
  type RedDefinitionLevierVue,
  type RedPlanVue,
  type RedStatutAction,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { formaterDate, type Devise } from "../../lib/format";
import {
  cheminCommentairesAction,
  cheminDeplacementAction,
  exigeDateFinAction,
  exigeMotifAction,
  libelleDomaine,
  libelleStatutAction,
  libelleVolet,
  messageRedressement,
  type CarteRang,
  majsRangApresDeplacement,
  statutsSuggeres,
} from "../../lib/redressement";
import { texteOuNull, type Resultat } from "../../lib/saisie";
import { dateValide } from "../../lib/periode";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { FormulaireAction, type OptionResponsable } from "./FormulaireAction";
import { ResumeImpact } from "./ImpactLevier";

type Panneau = "deplacer" | "modifier" | "commenter" | null;
type ChampDeplacement = "vers" | "motif" | "termine_le";

interface OutilsCarte {
  dossierId: string;
  peutEcrire: boolean;
  devise: Devise;
  responsables: OptionResponsable[];
  leviers: RedDefinitionLevierVue[];
  aujourdhui: string;
  peutAssignerTache: boolean;
}

function FormulaireDeplacement({
  action,
  aujourdhui,
}: {
  action: RedActionVue;
  aujourdhui: string;
}) {
  const f = useFormulaire<ChampDeplacement>();
  const suggeres = statutsSuggeres(action.statut);
  const [vers, setVers] = useState<string>(suggeres[0]?.valeur ?? "");
  const [motif, setMotif] = useState("");
  const [termineLe, setTermineLe] = useState(aujourdhui);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const statut = vers as RedStatutAction;
    const erreurs: Partial<Record<ChampDeplacement, string>> = {};
    if (vers === "") erreurs.vers = "Choisissez un statut.";
    const m = texteOuNull(motif);
    if (vers !== "" && exigeMotifAction(statut) && m === null) {
      erreurs.motif = "Un motif est demandé pour ce statut.";
    }
    if (vers !== "" && exigeDateFinAction(statut) && dateValide(termineLe) === null) {
      erreurs.termine_le = "Saisissez la date de fin.";
    }
    const validation: Resultat<Record<string, unknown>, ChampDeplacement> = Object.keys(erreurs)
      .length > 0
      ? { ok: false, erreurs }
      : {
          ok: true,
          charge: {
            statut,
            ...(m !== null ? { motif: m } : {}),
            ...(exigeDateFinAction(statut) ? { termine_le: termineLe } : {}),
          },
        };
    await f.envoyer(
      validation,
      (charge) => api.post<RedActionVue>(cheminDeplacementAction(action.id), charge),
      {
        succes: "Action déplacée.",
        messageSpecifique: messageRedressement,
      },
    );
  }

  if (suggeres.length === 0) {
    return (
      <p className="mp-texte-doux mp-texte-petit">
        Une action terminée ou abandonnée ne change plus de statut.
      </p>
    );
  }
  const statut = vers as RedStatutAction;
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Déplacer l'action ${action.numero}`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Déplacement refusé"
      />
      <Select
        libelle="Déplacer vers…"
        value={vers}
        onChange={(e) => setVers(e.target.value)}
        options={suggeres}
        erreur={f.erreurs.vers}
      />
      {vers !== "" && exigeMotifAction(statut) ? (
        <ZoneTexte
          libelle="Motif"
          required
          maxLength={1000}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
      ) : null}
      {vers !== "" && exigeDateFinAction(statut) ? (
        <Champ
          libelle="Date de fin"
          type="date"
          required
          value={termineLe}
          onChange={(e) => setTermineLe(e.target.value)}
          erreur={f.erreurs.termine_le}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Déplacement…">
          Déplacer
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireCommentaire({ actionId }: { actionId: string }) {
  const f = useFormulaire<"commentaire">();
  const [texte, setTexte] = useState("");
  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = texte.trim();
    const validation: Resultat<{ commentaire: string }, "commentaire"> =
      t === "" || t.length > 1000
        ? {
            ok: false,
            erreurs: { commentaire: "Saisissez un commentaire de 1 000 caractères au plus." },
          }
        : { ok: true, charge: { commentaire: t } };
    await f.envoyer(
      validation,
      (charge) => api.post<RedActionVue>(cheminCommentairesAction(actionId), charge),
      {
        succes: "Commentaire ajouté.",
        messageSpecifique: messageRedressement,
        apres: () => setTexte(""),
      },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Commenter l'action"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Commentaire refusé"
      />
      <ZoneTexte
        libelle="Commentaire"
        required
        maxLength={1000}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Envoi…">
          Commenter
        </Bouton>
      </div>
    </form>
  );
}

function CarteAction({
  action,
  colonne,
  outils,
}: {
  action: RedActionVue;
  colonne: readonly CarteRang[];
  outils: OutilsCarte;
}) {
  const { rafraichir, enAttente } = useRafraichir();
  const [panneau, setPanneau] = useState<Panneau>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const refAlerte = useRef<HTMLDivElement>(null);
  const terminal = action.statut === "terminee" || action.statut === "abandonnee";

  async function monterOuDescendre(sens: "monter" | "descendre") {
    const majs = majsRangApresDeplacement(colonne, action.id, sens);
    if (majs === null) return;
    setErreur(null);
    setEnCours(true);
    try {
      // Le rang est une clé de tri : les cartes touchées sont mises à jour l'une après l'autre.
      for (const m of majs) {
        await api.post(cheminDeplacementAction(m.id), { statut: action.statut, rang: m.rang });
      }
      rafraichir();
    } catch (e) {
      setErreur(messageRedressement(e));
      refAlerte.current?.focus();
    } finally {
      setEnCours(false);
    }
  }

  const bascule = (p: Exclude<Panneau, null>) => setPanneau((x) => (x === p ? null : p));
  return (
    <li className="mp-red-action">
      <p className="mp-red-action__titre">
        <span className="mp-texte-doux">n° {action.numero} · </span>
        {action.titre}
      </p>
      <div className="mp-red-action__meta">
        <BadgeStatut tonalite="neutre" sansIcone>
          {libelleVolet(action.volet)}
        </BadgeStatut>
        <span>{libelleDomaine(action.domaine)}</span>
        <span>Échéance {formaterDate(action.echeance)}</span>
        {action.en_retard ? <BadgeStatut tonalite="danger">En retard</BadgeStatut> : null}
      </div>
      <p className="mp-texte-petit">Responsable : {action.responsable.nom}</p>
      {action.levier ? <ResumeImpact impact={action.levier.impact} /> : null}
      {action.motif ? (
        <p className="mp-texte-petit mp-red-texte-libre">Motif : {action.motif}</p>
      ) : null}
      {action.termine_le ? (
        <p className="mp-texte-petit">Terminée le {formaterDate(action.termine_le)}</p>
      ) : null}
      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre="Déplacement refusé">
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {outils.peutEcrire ? (
        <div className="mp-red-action__actions">
          {!terminal ? (
            <>
              <Bouton
                variante="discret"
                disabled={
                  enCours || majsRangApresDeplacement(colonne, action.id, "monter") === null
                }
                aria-label={`Monter l'action ${action.numero}`}
                onClick={() => void monterOuDescendre("monter")}
              >
                <Icone nom="flecheHaut" taille={16} />
                <span>Monter</span>
              </Bouton>
              <Bouton
                variante="discret"
                disabled={
                  enCours || majsRangApresDeplacement(colonne, action.id, "descendre") === null
                }
                aria-label={`Descendre l'action ${action.numero}`}
                onClick={() => void monterOuDescendre("descendre")}
              >
                <Icone nom="flecheBas" taille={16} />
                <span>Descendre</span>
              </Bouton>
            </>
          ) : null}
          {!terminal ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "deplacer"}
              onClick={() => bascule("deplacer")}
            >
              Déplacer vers…
            </Bouton>
          ) : null}
          {!terminal ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "modifier"}
              onClick={() => bascule("modifier")}
            >
              Modifier
            </Bouton>
          ) : null}
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "commenter"}
            onClick={() => bascule("commenter")}
          >
            Commenter
          </Bouton>
        </div>
      ) : null}
      {panneau ? (
        <div className="mp-red-action__panneau">
          {panneau === "deplacer" ? (
            <FormulaireDeplacement action={action} aujourdhui={outils.aujourdhui} />
          ) : panneau === "modifier" ? (
            <FormulaireAction
              dossierId={outils.dossierId}
              devise={outils.devise}
              responsables={outils.responsables}
              leviers={outils.leviers}
              aujourdhui={outils.aujourdhui}
              peutAssignerTache={false}
              action={action}
              responsableParDefaut={action.responsable.id}
            />
          ) : (
            <FormulaireCommentaire actionId={action.id} />
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Kanban du plan (RED-07) : colonnes « À faire », « En cours », « Bloquée », « Terminée » et
 * section repliable « Abandonnées ». Sans glisser-déposer (repoussé : accessibilité et téléphone) :
 * chaque carte propose « Déplacer vers… » (statuts suggérés, motif pour « Bloquée » et
 * « Abandonnée », date de fin pour « Terminée »), « Monter », « Descendre », « Modifier » et
 * « Commenter ». Les propositions sont un confort d'affichage : l'API juge.
 */
export function KanbanActions({
  kanban,
  dossierId,
  peutEcrire,
  devise,
  responsables,
  leviers,
  aujourdhui,
  peutAssignerTache,
}: {
  kanban: RedPlanVue["kanban"];
  dossierId: string;
  peutEcrire: boolean;
  devise: Devise;
  responsables: OptionResponsable[];
  leviers: RedDefinitionLevierVue[];
  aujourdhui: string;
  peutAssignerTache: boolean;
}) {
  const outils: OutilsCarte = {
    dossierId,
    peutEcrire,
    devise,
    responsables,
    leviers,
    aujourdhui,
    peutAssignerTache,
  };
  return (
    <div className="mp-red-section">
      <div className="mp-red-kanban">
        {RED_COLONNES_KANBAN.map((c: RedColonneKanban) => {
          const liste = kanban.colonnes[c] ?? [];
          const cartes = liste.map((a) => ({ id: a.id, rang: a.rang }));
          return (
            <section key={c} className="mp-red-colonne" aria-labelledby={`colonne-${c}`}>
              <h3 id={`colonne-${c}`} className="mp-red-colonne__titre">
                {libelleStatutAction(c)} ({liste.length})
              </h3>
              {liste.length === 0 ? (
                <p className="mp-texte-doux mp-texte-petit">Aucune action.</p>
              ) : (
                <ul className="mp-red-colonne__liste">
                  {liste.map((a) => (
                    <CarteAction key={a.id} action={a} colonne={cartes} outils={outils} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {kanban.abandonnees.length > 0 ? (
        <details className="mp-details">
          <summary>Abandonnées ({kanban.abandonnees.length})</summary>
          <ul className="mp-red-colonne__liste">
            {kanban.abandonnees.map((a) => (
              <CarteAction
                key={a.id}
                action={a}
                colonne={kanban.abandonnees.map((x) => ({ id: x.id, rang: x.rang }))}
                outils={outils}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

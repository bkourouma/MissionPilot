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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampDeplacement>();
  const suggeres = statutsSuggeres(action.statut, langue);
  const [vers, setVers] = useState<string>(suggeres[0]?.valeur ?? "");
  const [motif, setMotif] = useState("");
  const [termineLe, setTermineLe] = useState(aujourdhui);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const statut = vers as RedStatutAction;
    const erreurs: Partial<Record<ChampDeplacement, string>> = {};
    if (vers === "") erreurs.vers = t("Choisissez un statut.", "Choose a status.");
    const m = texteOuNull(motif);
    if (vers !== "" && exigeMotifAction(statut) && m === null) {
      erreurs.motif = t(
        "Un motif est demandé pour ce statut.",
        "A reason is required for this status.",
      );
    }
    if (vers !== "" && exigeDateFinAction(statut) && dateValide(termineLe) === null) {
      erreurs.termine_le = t("Saisissez la date de fin.", "Enter the end date.");
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
        succes: t("Action déplacée.", "Action moved."),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  if (suggeres.length === 0) {
    return (
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Une action terminée ou abandonnée ne change plus de statut.",
          "A completed or dropped action no longer changes status.",
        )}
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
      aria-label={t(`Déplacer l'action ${action.numero}`, `Move action ${action.numero}`)}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Déplacement refusé", "Move refused")}
      />
      <Select
        libelle={t("Déplacer vers…", "Move to…")}
        value={vers}
        onChange={(e) => setVers(e.target.value)}
        options={suggeres}
        erreur={f.erreurs.vers}
      />
      {vers !== "" && exigeMotifAction(statut) ? (
        <ZoneTexte
          libelle={t("Motif", "Reason")}
          required
          maxLength={1000}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
      ) : null}
      {vers !== "" && exigeDateFinAction(statut) ? (
        <Champ
          libelle={t("Date de fin", "End date")}
          type="date"
          required
          value={termineLe}
          onChange={(e) => setTermineLe(e.target.value)}
          erreur={f.erreurs.termine_le}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Déplacement…", "Moving…")}>
          {t("Déplacer", "Move")}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireCommentaire({ actionId }: { actionId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"commentaire">();
  const [texte, setTexte] = useState("");
  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const net = texte.trim();
    const validation: Resultat<{ commentaire: string }, "commentaire"> =
      net === "" || net.length > 1000
        ? {
            ok: false,
            erreurs: {
              commentaire: t(
                "Saisissez un commentaire de 1 000 caractères au plus.",
                "Enter a comment of 1,000 characters at most.",
              ),
            },
          }
        : { ok: true, charge: { commentaire: net } };
    await f.envoyer(
      validation,
      (charge) => api.post<RedActionVue>(cheminCommentairesAction(actionId), charge),
      {
        succes: t("Commentaire ajouté.", "Comment added."),
        messageSpecifique: (e) => messageRedressement(e, langue),
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
      aria-label={t("Commenter l'action", "Comment on the action")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Commentaire refusé", "Comment refused")}
      />
      <ZoneTexte
        libelle={t("Commentaire", "Comment")}
        required
        maxLength={1000}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Envoi…", "Sending…")}>
          {t("Commenter", "Comment")}
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
  const t = useT();
  const langue = useLangue();
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
      setErreur(messageRedressement(e, langue));
      refAlerte.current?.focus();
    } finally {
      setEnCours(false);
    }
  }

  const bascule = (p: Exclude<Panneau, null>) => setPanneau((x) => (x === p ? null : p));
  return (
    <li className="mp-red-action">
      <p className="mp-red-action__titre">
        <span className="mp-texte-doux">
          {t("n°", "No.")} {action.numero} ·{" "}
        </span>
        {action.titre}
      </p>
      <div className="mp-red-action__meta">
        <BadgeStatut tonalite="neutre" sansIcone>
          {libelleVolet(action.volet, langue)}
        </BadgeStatut>
        <span>{libelleDomaine(action.domaine, langue)}</span>
        <span>
          {t("Échéance", "Due")} {formaterDate(action.echeance, "UTC", langue)}
        </span>
        {action.en_retard ? (
          <BadgeStatut tonalite="danger">{t("En retard", "Overdue")}</BadgeStatut>
        ) : null}
      </div>
      <p className="mp-texte-petit">
        {t("Responsable :", "Owner:")} {action.responsable.nom}
      </p>
      {action.levier ? <ResumeImpact impact={action.levier.impact} /> : null}
      {action.motif ? (
        <p className="mp-texte-petit mp-red-texte-libre">
          {t("Motif :", "Reason:")} {action.motif}
        </p>
      ) : null}
      {action.termine_le ? (
        <p className="mp-texte-petit">
          {t("Terminée le", "Completed on")} {formaterDate(action.termine_le, "UTC", langue)}
        </p>
      ) : null}
      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre={t("Déplacement refusé", "Move refused")}>
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
                aria-label={t(
                  `Monter l'action ${action.numero}`,
                  `Move action ${action.numero} up`,
                )}
                onClick={() => void monterOuDescendre("monter")}
              >
                <Icone nom="flecheHaut" taille={16} />
                <span>{t("Monter", "Move up")}</span>
              </Bouton>
              <Bouton
                variante="discret"
                disabled={
                  enCours || majsRangApresDeplacement(colonne, action.id, "descendre") === null
                }
                aria-label={t(
                  `Descendre l'action ${action.numero}`,
                  `Move action ${action.numero} down`,
                )}
                onClick={() => void monterOuDescendre("descendre")}
              >
                <Icone nom="flecheBas" taille={16} />
                <span>{t("Descendre", "Move down")}</span>
              </Bouton>
            </>
          ) : null}
          {!terminal ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "deplacer"}
              onClick={() => bascule("deplacer")}
            >
              {t("Déplacer vers…", "Move to…")}
            </Bouton>
          ) : null}
          {!terminal ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "modifier"}
              onClick={() => bascule("modifier")}
            >
              {t("Modifier", "Edit")}
            </Bouton>
          ) : null}
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "commenter"}
            onClick={() => bascule("commenter")}
          >
            {t("Commenter", "Comment")}
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
  const t = useT();
  const langue = useLangue();
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
                {libelleStatutAction(c, langue)} ({liste.length})
              </h3>
              {liste.length === 0 ? (
                <p className="mp-texte-doux mp-texte-petit">{t("Aucune action.", "No action.")}</p>
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
          <summary>
            {t("Abandonnées", "Dropped")} ({kanban.abandonnees.length})
          </summary>
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
